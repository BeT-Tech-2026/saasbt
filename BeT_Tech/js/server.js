// server.js - B&T Tech (ATUALIZADO)
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const BASE_URL = (process.env.BASE_URL || '').trim() || 'https://saasbt.vercel.app';

console.log('Servidor iniciado...');
console.log('BASE_URL:', BASE_URL);
console.log('__dirname:', __dirname);

// ==================== AUTENTICAÇÃO ====================
const authenticate = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'Token não fornecido' });

        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error) throw error;

        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token inválido' });
    }
};

const getPerfil = async (userId) => {
    const { data } = await supabase
        .from('perfis')
        .select('*, escolas(nome)')
        .eq('id', userId)
        .single();
    return data;
};

// ==================== ROTAS PÚBLICAS ====================

app.get('/confirmar', (req, res) => {
    console.log('>>> Acessando /confirmar');
    console.log('>>> Query:', req.query);
    
    const possiveisCaminhos = [
        path.join(__dirname, 'pages', 'confirmar.html'),
        path.join(__dirname, '..', 'pages', 'confirmar.html'),
        path.join(__dirname, '..', '..', 'pages', 'confirmar.html'),
        path.join(process.cwd(), 'pages', 'confirmar.html'),
        path.join(process.cwd(), 'src', 'pages', 'confirmar.html'),
        '/app/pages/confirmar.html',
        '/opt/render/project/src/pages/confirmar.html'
    ];
    
    let arquivoEncontrado = null;
    for (const caminho of possiveisCaminhos) {
        if (fs.existsSync(caminho)) {
            arquivoEncontrado = caminho;
            break;
        }
    }
    
    if (arquivoEncontrado) {
        return res.sendFile(arquivoEncontrado);
    }
    
    res.status(404).send(`
        <h1>Erro 404 - Página não encontrada</h1>
        <p>O arquivo confirmar.html não foi encontrado.</p>
        <p><strong>Diretório atual:</strong> ${__dirname}</p>
        <ul>${possiveisCaminhos.map(c => `<li>${c}</li>`).join('')}</ul>
    `);
});


// API - Buscar aulas do aluno
app.get('/api/aulas-aluno', async (req, res) => {
    const { aluno } = req.query;
    if (!aluno) return res.json({ success: false, error: 'ID do aluno não fornecido' });

    try {
        const { data: alunoData, error: alunoError } = await supabase
            .from('alunos').select('nome').eq('id', aluno).single();
        if (alunoError || !alunoData)
            return res.json({ success: false, error: 'Aluno não encontrado' });

        const { data: matriculas } = await supabase
            .from('matriculas')
            .select('*, turmas(id, nome, dia_semana, horario_inicio, horario_fim, escola_id, data_avulsa)')
            .eq('aluno_id', aluno)
            .eq('ativa', true);

        if (!matriculas || matriculas.length === 0)
            return res.json({ success: true, dados: { aluno_nome: alunoData.nome, aulas: [] } });

        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        const aulas = [];

        for (const mat of matriculas) {
            const turma = mat.turmas;
            if (!turma) continue;

            let dataAulaValida = null;

            if (turma.data_avulsa) {
                const dataAvulsaDate = new Date(turma.data_avulsa + 'T00:00:00');
                if (dataAvulsaDate >= hoje && dataAvulsaDate <= new Date(hoje.getTime() + 14 * 86400000)) {
                    dataAulaValida = dataAvulsaDate;
                }
            } else {
                for (let i = 0; i <= 14; i++) {
                    const dataFutura = new Date(hoje);
                    dataFutura.setDate(hoje.getDate() + i);
                    if (diasSemana[dataFutura.getDay()] !== turma.dia_semana) continue;
                    dataAulaValida = dataFutura;
                    break;
                }
            }

            if (dataAulaValida) {
                const dataStr = dataAulaValida.toISOString().split('T')[0];
                const aulaId  = `${turma.id}_${dataStr}`;

                const { data: presencaExistente } = await supabase
                    .from('presencas').select('id, status')
                    .eq('aula_id', aulaId).eq('aluno_id', aluno).single();

                if (presencaExistente && presencaExistente.status !== 'pendente') {
                    continue; 
                }

                let presencaId = presencaExistente?.id;

                if (!presencaExistente) {
                    const { data: nova } = await supabase
                        .from('presencas')
                        .insert({
                            aula_id: aulaId,
                            aluno_id: aluno,
                            turma_id: turma.id,
                            escola_id: turma.escola_id,
                            status: 'pendente'
                        })
                        .select('id').single();
                    presencaId = nova?.id;
                }

                if (!presencaId) break;

                aulas.push({
                    presenca_id: presencaId,
                    aula_id: aulaId,
                    turma_nome: turma.nome,
                    data: dataAulaValida.toLocaleDateString('pt-BR', {
                        weekday: 'long', day: 'numeric', month: 'long'
                    }),
                    data_raw: dataStr,
                    horario_inicio: turma.horario_inicio?.substring(0, 5) || '-',
                    horario_fim: turma.horario_fim?.substring(0, 5) || '-',
                    status: 'pendente'
                });
            }
        }

        res.json({ success: true, dados: { aluno_nome: alunoData.nome, aulas } });

    } catch (error) {
        console.error('Erro em aulas-aluno:', error);
        res.json({ success: false, error: error.message });
    }
});


// API - Confirmar presença
app.post('/api/confirmar-presenca', async (req, res) => {
    const { presenca_id, status } = req.body;
    if (!presenca_id) {
        return res.json({ success: false, error: 'ID da presença não fornecido' });
    }
    
    const { error } = await supabase
        .from('presencas')
        .update({ status: status, updated_at: new Date().toISOString() })
        .eq('id', presenca_id);
    
    if (error) {
        return res.json({ success: false, error: error.message });
    }
    
    res.json({ success: true });
});

// ==================== ROTAS DE AUTENTICAÇÃO ====================

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const perfil = await getPerfil(data.user.id);
        if (!perfil) {
            await supabase.auth.signOut();
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }
        res.json({ user: data.user, perfil: perfil, access_token: data.session.access_token });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

app.post('/api/logout', async (req, res) => {
    await supabase.auth.signOut();
    res.json({ success: true });
});

app.post('/api/cadastro', async (req, res) => {
    try {
        const { nome, email, password, nomeEscola, escola_id, tipo, cor } = req.body;
        if (!nome || !email || !password) {
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
        }

        let escolaId = escola_id;
        if (!escolaId) {
            const { data: donoExistente } = await supabase.from('perfis').select('escola_id').eq('tipo', 'dono').limit(1).single();
            if (donoExistente) {
                escolaId = donoExistente.escola_id;
            } else {
                const { data: escola, error: escolaError } = await supabase.from('escolas').insert({ nome: nomeEscola || 'Minha Escola' }).select().single();
                if (escolaError) throw escolaError;
                escolaId = escola.id;
            }
        }

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: email, password: password, email_confirm: true, user_metadata: { nome: nome }
        });
        if (authError) throw authError;

        const { data: perfil, error: perfilError } = await supabase.from('perfis').insert({
            id: authData.user.id, escola_id: escolaId, nome: nome, email: email,
            tipo: tipo === 'dono' ? 'dono' : 'professor', ativo: true, cor: cor || '#3b82f6'
        }).select().single();

        if (perfilError) throw perfilError;
        res.status(201).json({ message: 'Cadastro realizado com sucesso!', perfil });
    } catch (error) {
        console.error('Erro no cadastro:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/session', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        res.json({ user: req.user, perfil });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

app.get('/api/escolas', async (req, res) => {
    try {
        const { data, error } = await supabase.from('escolas').select('id, nome').order('nome');
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE ALUNOS ====================

app.get('/api/alunos', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { data: alunos } = await supabase.from('alunos').select('*').eq('escola_id', perfil.escola_id).eq('ativo', true).order('nome');
        
        const alunosComTurmas = await Promise.all((alunos || []).map(async (aluno) => {
            const { data: matriculas } = await supabase.from('matriculas').select('*, turmas(nome)').eq('aluno_id', aluno.id).eq('ativa', true);
            const turmas = matriculas?.map(m => m.turmas?.nome).filter(Boolean) || [];
            return { ...aluno, turmas };
        }));
        
        res.json(alunosComTurmas);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/alunos', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { nome, telefone, email } = req.body;
        const { data, error } = await supabase.from('alunos').insert({ escola_id: perfil.escola_id, nome, telefone, email }).select().single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/alunos/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { nome, telefone, email } = req.body;
        const { data: alunoExistente } = await supabase.from('alunos').select('escola_id').eq('id', req.params.id).single();
        if (!alunoExistente || alunoExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        const { data, error } = await supabase.from('alunos').update({ nome, telefone, email }).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/alunos/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { data: alunoExistente } = await supabase.from('alunos').select('escola_id').eq('id', req.params.id).single();
        if (!alunoExistente || alunoExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        await supabase.from('alunos').update({ ativo: false }).eq('id', req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE PROFESSORES ====================

app.get('/api/professores', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        if (perfil.tipo === 'professor') {
            const { data } = await supabase.from('perfis').select('*').eq('id', req.user.id);
            return res.json(data || []);
        }
        const { data } = await supabase.from('perfis').select('*').eq('escola_id', perfil.escola_id).eq('tipo', 'professor').eq('ativo', true);
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/professores', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        const { nome, email, senha, cor } = req.body;
        if (!senha || senha.length < 6) {
            return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
        }
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: email, password: senha, email_confirm: true, user_metadata: { nome: nome }
        });
        if (authError) throw authError;
        const { error: perfilError } = await supabase.from('perfis').insert({
            id: authData.user.id, escola_id: perfil.escola_id, nome: nome, email: email,
            tipo: 'professor', ativo: true, cor: cor || '#3b82f6'
        });
        if (perfilError) throw perfilError;
        res.json({ success: true, email, senha });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/professores/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { data: professorExistente } = await supabase.from('perfis').select('escola_id').eq('id', req.params.id).single();
        if (!professorExistente || professorExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        await supabase.from('perfis').update({ ativo: false }).eq('id', req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE PROFESSORES (continuação) ====================

// GET /api/professores/:id - Buscar professor por ID (para edição)
app.get('/api/professores/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { data: professor } = await supabase
            .from('perfis')
            .select('id, nome, email, cor')
            .eq('id', req.params.id)
            .eq('escola_id', perfil.escola_id)
            .single();

        if (!professor) {
            return res.status(404).json({ error: 'Professor não encontrado' });
        }

        res.json(professor);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/professores/:id - Atualizar professor (editar)
app.put('/api/professores/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { data: professorExistente } = await supabase
            .from('perfis')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();

        if (!professorExistente || professorExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Professor não encontrado nesta escola' });
        }

        const { nome, email, senha, cor } = req.body;
        const updates = {};

        if (nome) updates.nome = nome;
        if (email) updates.email = email;
        if (cor) updates.cor = cor;

        // Se quiser mudar a senha via Supabase Auth Admin
        if (senha && senha.length >= 6) {
            const { error: senhaError } = await supabase.auth.admin.updateUserById(
                req.params.id,
                { password: senha }
            );
            if (senhaError) {
                console.error('Erro ao atualizar senha:', senhaError);
                // Não bloqueia a atualização dos outros dados
            }
        }

        const { data, error } = await supabase
            .from('perfis')
            .update(updates)
            .eq('id', req.params.id)
            .select('id, nome, email, cor')
            .single();

        if (error) throw error;
        res.json({ success: true, professor: data });

    } catch (error) {
        console.error('Erro ao atualizar professor:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE TURMAS ====================

app.get('/api/turmas', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { data: turmas, error } = await supabase.from('turmas').select('*, perfis(nome, cor)').eq('escola_id', perfil.escola_id).eq('ativa', true);
        if (error) throw error;
        if (perfil.tipo === 'professor') {
            const turmasDoProfessor = (turmas || []).filter(t => t.professor_id === perfil.id);
            return res.json(turmasDoProfessor);
        }
        res.json(turmas || []);
    } catch (error) {
        console.error('Erro ao buscar turmas:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/turmas', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { turmas, nome, dia_semana, horario_inicio, horario_fim, professor_id, limite_alunos, data_avulsa } = req.body;
        
        if (turmas && Array.isArray(turmas)) {
            const turmasFormatadas = turmas.map(t => ({
                escola_id: perfil.escola_id, nome: t.nome, dia_semana: t.dia_semana,
                horario_inicio: t.horario_inicio, horario_fim: t.horario_fim,
                professor_id: t.professor_id || null, limite_alunos: t.limite_alunos || 4,
                ativa: true, data_avulsa: t.data_avulsa || null
            }));
            const { data, error } = await supabase.from('turmas').insert(turmasFormatadas).select('*, perfis(nome, cor)');
            if (error) throw error;
            return res.json(data);
        }
        
        const turmaUnica = {
            escola_id: perfil.escola_id, nome: nome, dia_semana: dia_semana,
            horario_inicio, horario_fim, professor_id: professor_id || null,
            limite_alunos: limite_alunos || 4, ativa: true, data_avulsa: data_avulsa || null
        };
        
        const { data, error } = await supabase.from('turmas').insert(turmaUnica).select('*, perfis(nome, cor)').single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/turmas/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { nome, dia_semana, horario_inicio, horario_fim, professor_id, limite_alunos, data_avulsa } = req.body;
        const { data: turmaExistente } = await supabase.from('turmas').select('escola_id').eq('id', req.params.id).single();
        if (!turmaExistente || turmaExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        const { data, error } = await supabase.from('turmas').update({ nome, dia_semana, horario_inicio, horario_fim, professor_id, limite_alunos, data_avulsa }).eq('id', req.params.id).select('*, perfis(nome, cor)').single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/turmas/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { data: turmaExistente } = await supabase.from('turmas').select('escola_id').eq('id', req.params.id).single();
        if (!turmaExistente || turmaExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        await supabase.from('turmas').update({ ativa: false }).eq('id', req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE MATRÍCULAS ====================

app.get('/api/matriculas/:turmaId', authenticate, async (req, res) => {
    try {
        const { data } = await supabase.from('matriculas').select('*, alunos(*)').eq('turma_id', req.params.turmaId).eq('ativa', true);
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/matriculas', authenticate, async (req, res) => {
    try {
        const { turma_id, aluno_id } = req.body;
        const { data: turma } = await supabase.from('turmas').select('limite_alunos').eq('id', turma_id).single();
        const { count } = await supabase.from('matriculas').select('*', { count: 'exact', head: true }).eq('turma_id', turma_id).eq('ativa', true);
        if (count >= turma.limite_alunos) {
            return res.status(400).json({ error: 'Turma lotada' });
        }
        const { data: existente } = await supabase.from('matriculas').select('*').eq('turma_id', turma_id).eq('aluno_id', aluno_id).eq('ativa', true).single();
        if (existente) {
            return res.status(400).json({ error: 'Aluno já matriculado nesta turma' });
        }
        const { data, error } = await supabase.from('matriculas').insert({ turma_id, aluno_id, ativa: true }).select().single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/matriculas/:id', authenticate, async (req, res) => {
    try {
        await supabase.from('matriculas').update({ ativa: false }).eq('id', req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE CONFIRMAÇÕES ====================

app.post('/api/gerar-link-unico', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { turma_id, aluno_id, data, horario } = req.body;
        
        if (!turma_id || !aluno_id) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }
        
        const hoje = new Date();
        const amanha = new Date(Date.now() + 86400000);
        const dataHoje = hoje.toISOString().split('T')[0];
        const dataAmanha = amanha.toISOString().split('T')[0];
        
        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hojeDia = diasSemana[hoje.getDay()];
        
        const { data: turma } = await supabase.from('turmas').select('*').eq('id', turma_id).single();
        
        if (!turma) {
            return res.status(400).json({ error: 'Turma não encontrada' });
        }
        
        const dataAula = data || turma.data_avulsa || (turma.dia_semana === hojeDia ? dataHoje : dataAmanha);
        const aulaId = `${turma_id}_${dataAula}`;
        
        const linkConfirmacao = `${BASE_URL}/confirmar?aluno=${aluno_id}`;
        
        const { error: presencaError } = await supabase.from('presencas').upsert({
            aula_id: aulaId,
            aluno_id: aluno_id,
            turma_id: turma_id,
            escola_id: perfil.escola_id,
            status: 'pendente',
            expires_at: new Date(Date.now() + 86400000 * 3).toISOString()
        }, { onConflict: 'aula_id,aluno_id' });
        
        if (presencaError) {
            return res.status(500).json({ error: presencaError.message });
        }
        
        console.log('Link gerado:', linkConfirmacao);
        res.json({ success: true, link: linkConfirmacao });
    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/gerar-links-confirmacao', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const hoje = new Date();
        const amanha = new Date(Date.now() + 86400000);
        const dataHoje = hoje.toISOString().split('T')[0];
        const dataAmanha = amanha.toISOString().split('T')[0];
        
        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hojeDia = diasSemana[hoje.getDay()];
        const amanhaDia = diasSemana[amanha.getDay()];
        
        const { data: turmas } = await supabase.from('turmas').select('*').eq('escola_id', perfil.escola_id).eq('ativa', true);
        
        const turmasFiltradas = (turmas || []).filter(t => 
            t.dia_semana === hojeDia || t.dia_semana === amanhaDia ||
            t.data_avulsa === dataHoje || t.data_avulsa === dataAmanha
        );
        
        let links = [];
        
        for (const turma of turmasFiltradas) {
            const { data: matriculas } = await supabase.from('matriculas').select('*, alunos(*)').eq('turma_id', turma.id).eq('ativa', true);
            
            const dataAula = turma.data_avulsa || (turma.dia_semana === hojeDia ? dataHoje : dataAmanha);
            const aulaId = `${turma.id}_${dataAula}`;
            
            const dataFormatada = new Date(dataAula + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
            const horario = turma.horario_inicio ? String(turma.horario_inicio).substring(0, 5) : '00:00';
            
            for (const mat of (matriculas || [])) {
                if (!mat.alunos?.telefone) continue;
                
                await supabase.from('presencas').upsert({
                    aula_id: aulaId,
                    aluno_id: mat.aluno_id,
                    turma_id: turma.id,
                    escola_id: perfil.escola_id,
                    status: 'pendente',
                    expires_at: new Date(Date.now() + 86400000 * 3).toISOString()
                }, { onConflict: 'aula_id,aluno_id' });
                
                const linkConfirmacao = `${BASE_URL}/confirmar?aluno=${mat.aluno_id}`;
                
                const mensagem = `Confirmacao de Aula\n\nOlá ${mat.alunos.nome}!\n\nAula: ${turma.nome}\nData: ${dataFormatada}\nHorario: ${horario}\n\nConfirme sua presenca:\n${linkConfirmacao}\n\nB&T Tech`;
                
                links.push({
                    id: mat.aluno_id,
                    aluno: mat.alunos.nome,
                    telefone: mat.alunos.telefone,
                    turma: turma.nome,
                    data: dataFormatada,
                    horario: horario,
                    link: linkConfirmacao,
                    mensagem: mensagem
                });
            }
        }
        
        res.json({ success: true, links });
    } catch (error) {
        console.error('Erro:', error);
        res.status(500).json({ error: error.message });
    }
});




// Substituir TODO o conteúdo da rota /api/aulas-confirmacoes por:

app.get('/api/aulas-confirmacoes', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const agora = new Date();
        const offset = -3 * 60;
        const hoje = new Date(agora.getTime() + agora.getTimezoneOffset() * 60000 + offset * 60000);
        const dataHoje = hoje.toISOString().split('T')[0];
        
        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hojeDia = diasSemana[hoje.getDay()];
        
        const { data: turmas } = await supabase.from('turmas')
            .select('*, perfis(nome)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);
        
        console.log('Total turmas encontradas:', turmas?.length);
        
        async function getAlunosComStatus(turmaId, aulaId) {
            const { data: matriculas } = await supabase
                .from('matriculas')
                .select('*, alunos(id, nome, telefone)')
                .eq('turma_id', turmaId)
                .eq('ativa', true);
            
            if (!matriculas || matriculas.length === 0) return [];
            
            const { data: presencas } = await supabase
                .from('presencas')
                .select('id, aluno_id, status')
                .eq('aula_id', aulaId);
            
            const presencasMap = {};
            if (presencas) {
                presencas.forEach(p => { presencasMap[p.aluno_id] = p; });
            }
            
            return matriculas.map(mat => ({
                id: mat.aluno_id,
                nome: mat.alunos?.nome,
                telefone: mat.alunos?.telefone,
                status: presencasMap[mat.aluno_id]?.status || 'pendente',
                link: `${BASE_URL}/confirmar?aluno=${mat.aluno_id}`
            }));
        }
        
        function getProximaData(turma) {
            // Usar purely date string para evitar problemas de timezone
            const dataAvulsaStr = turma.data_avulsa;
            
            if (dataAvulsaStr) {
                // Para aulas avulsas, compara string diretamente (YYYY-MM-DD)
                const hojeStr = new Date().toLocaleDateString('pt-BR').split('/').reverse().join('-');
                
                if (dataAvulsaStr >= hojeStr) {
                    return { dataStr: dataAvulsaStr, tipo: 'avulsa' };
                }
                return null;
            }
            
            if (turma.dia_semana) {
                const hojeTemp = new Date();
                for (let i = 0; i < 7; i++) {
                    const dataFutura = new Date(hojeTemp);
                    dataFutura.setDate(hojeTemp.getDate() + i);
                    if (diasSemana[dataFutura.getDay()] === turma.dia_semana) {
                        return { dataStr: dataFutura.toISOString().split('T')[0], tipo: 'semanal' };
                    }
                }
            }
            
            return null;
        }
        
        let todasAulas = [];
        
        for (const turma of (turmas || [])) {
            const infoData = getProximaData(turma);
            
            if (!infoData) continue;
            
            const dataStr = infoData.dataStr;
            
            // Calcular data de amanha corretamente
            const amanhaDate = new Date();
            amanhaDate.setDate(amanhaDate.getDate() + 1);
            const dataAmanha = amanhaDate.toISOString().split('T')[0];
            
            const aulaId = `${turma.id}_${dataStr}`;
            const alunos = await getAlunosComStatus(turma.id, aulaId);
            
            const ehHoje = dataStr === dataHoje;
            const ehAmanha = dataStr === dataAmanha;
            
            // Criar objeto Date apenas para formatação
            const dataFormat = new Date(dataStr + 'T12:00:00');
            const dataFormatada = dataFormat.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
            
            todasAulas.push({
                id: turma.id,
                nome: turma.nome,
                professor: turma.perfis?.nome,
                horario_inicio: turma.horario_inicio,
                horario_fim: turma.horario_fim,
                data_formatada: dataFormatada,
                data_raw: dataStr,
                dia_semana: turma.dia_semana,
                data_avulsa: turma.data_avulsa,
                ehHoje: ehHoje,
                ehAmanha: ehAmanha,
                alunos: alunos
            });
        }
        
        let aulasHoje = todasAulas.filter(a => a.ehHoje);
        let aulasAmanha = todasAulas.filter(a => a.ehAmanha);
        let aulasProximos = todasAulas.filter(a => !a.ehHoje && !a.ehAmanha);
        
        aulasHoje.sort((a, b) => (a.horario_inicio || '').localeCompare(b.horario_inicio || ''));
        aulasAmanha.sort((a, b) => (a.horario_inicio || '').localeCompare(b.horario_inicio || ''));
        aulasProximos.sort((a, b) => (a.data_raw || '').localeCompare(b.data_raw || ''));
        
        aulasProximos = aulasProximos.slice(0, 20);
        
        console.log('Resultado - Hoje:', aulasHoje.length, 'Amanha:', aulasAmanha.length, 'Proximos:', aulasProximos.length);
        
        res.json({ hoje: aulasHoje, amanha: aulasAmanha, proximos: aulasProximos });
        
    } catch (error) {
        console.error('Erro em /api/aulas-confirmacoes:', error);
        res.status(500).json({ error: error.message });
    }
});



// ==================== ROTAS DE PAINEL ====================

app.get('/api/painel', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = diasSemana[new Date().getDay()];
        const dataHoje = new Date().toISOString().split('T')[0];

        const { data: turmas } = await supabase.from('turmas').select('*, perfis(nome, cor)').eq('escola_id', perfil.escola_id).eq('ativa', true).or(`dia_semana.eq.${hoje},data_avulsa.eq.${dataHoje}`);
        
        let turmasFiltradas = turmas || [];
        
        if (perfil.tipo === 'professor') {
            turmasFiltradas = turmasFiltradas.filter(t => t.professor_id === perfil.id);
        }

        let turmasComAlunos = await Promise.all((turmasFiltradas || []).map(async (turma) => {
            const { data: matriculas } = await supabase.from('matriculas').select('*, alunos(*)').eq('turma_id', turma.id).eq('ativa', true);
            
            const aulaId = `${turma.id}_${turma.data_avulsa || dataHoje}`;
            const { data: presencas } = await supabase.from('presencas').select('*').eq('aula_id', aulaId);
            
            const alunos = (matriculas || []).map(m => {
                const presenca = presencas?.find(p => p.aluno_id === m.aluno_id);
                return { ...m, status_confirmacao: presenca?.status || 'pendente' };
            });
            
            return { ...turma, alunos };
        }));

        res.json(turmasComAlunos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== 🔥 ROTA DO DASHBOARD ====================

app.get('/api/dashboard', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const { count: alunosAtivos } = await supabase
            .from('alunos')
            .select('*', { count: 'exact', head: true })
            .eq('escola_id', perfil.escola_id)
            .eq('ativo', true);
        
        const { count: turmasAtivas } = await supabase
            .from('turmas')
            .select('*', { count: 'exact', head: true })
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);
        
        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = diasSemana[new Date().getDay()];
        const dataHoje = new Date().toISOString().split('T')[0];
        
        const { data: aulasHoje } = await supabase
            .from('turmas')
            .select('*, perfis(nome, cor)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true)
            .or(`dia_semana.eq.${hoje},data_avulsa.eq.${dataHoje}`);
        
        let aulasFiltradas = aulasHoje || [];
        if (perfil.tipo === 'professor') {
            aulasFiltradas = aulasFiltradas.filter(t => t.professor_id === perfil.id);
        }
        
        res.json({
            alunosAtivos: alunosAtivos || 0,
            turmasAtivas: turmasAtivas || 0,
            aulasHoje: aulasFiltradas
        });
        
    } catch (error) {
        console.error('Erro no dashboard:', error);
        res.status(500).json({ error: error.message });
    }
});


// ==================== 💰 ROTAS FINANCEIRAS ====================

// ✅ USA: configuracoes_financeiras (plural - como está no seu BD)

app.get('/api/config-financeiras', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const { data, error } = await supabase
            .from('configuracoes_financeiras')  // ← Nome correto da tabela
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Erro ao buscar config financeiras:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/config-financeiras', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const { tipo, valor, quantidade, descricao } = req.body;
        
        const { data, error } = await supabase
            .from('configuracoes_financeiras')  // ← Nome correto da tabela
            .insert({
                escola_id: perfil.escola_id,
                tipo: tipo,
                valor: parseFloat(valor),
                quantidade: quantidade || 1,
                descricao: descricao || ''
            })
            .select()
            .single();
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Erro ao criar config financeira:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/config-financeiras/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const { data: existente } = await supabase
            .from('configuracoes_financeiras')  // ← Nome correto da tabela
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!existente || existente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        await supabase.from('configuracoes_financeiras').delete().eq('id', req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao excluir config financeira:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== 📊 ROTA DE RELATÓRIOS ====================

app.get('/api/relatorios', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { inicio, fim } = req.query;

        // Total de alunos
        const { count: totalAlunos } = await supabase
            .from('alunos')
            .select('*', { count: 'exact', head: true })
            .eq('escola_id', perfil.escola_id)
            .eq('ativo', true);

        // Alunos novos este mês
        const primeiroDiaMes = new Date();
        primeiroDiaMes.setDate(1);
        primeiroDiaMes.setHours(0, 0, 0, 0);

        const { count: alunosNovosMes } = await supabase
            .from('alunos')
            .select('*', { count: 'exact', head: true })
            .eq('escola_id', perfil.escola_id)
            .eq('ativo', true)
            .gte('created_at', primeiroDiaMes.toISOString());

        // Total de turmas
        const { data: todasTurmas } = await supabase
            .from('turmas')
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);

        // Total de aulas (contando dias entre inicio e fim)
        let totalAulas = 0;
        let aulasSemana = 0;

        if (inicio && fim) {
            const startDate = new Date(inicio);
            const endDate = new Date(fim);
            const hoje = new Date();
            const inicioSemana = new Date(hoje);
            inicioSemana.setDate(hoje.getDate() - hoje.getDay());
            const fimSemana = new Date(inicioSemana);
            fimSemana.setDate(inicioSemana.getDate() + 6);

            const diasSemanaNomes = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const diaNome = diasSemanaNomes[d.getDay()];
                const aulasHoje = todasTurmas.filter(t => t.dia_semana === diaNome);
                totalAulas += aulasHoje.length;

                // Aulas desta semana
                if (d >= inicioSemana && d <= fimSemana) {
                    aulasSemana += aulasHoje.length;
                }
            }
        }

        // Turmas esta semana
        const hoje = new Date();
        const inicioSemana = new Date(hoje);
        inicioSemana.setDate(hoje.getDate() - hoje.getDay());
        const fimSemana = new Date(inicioSemana);
        fimSemana.setDate(inicioSemana.getDate() + 6);
        const diasSemanaNomes = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        let turmasSemana = 0;
        for (let d = new Date(inicioSemana); d <= fimSemana; d.setDate(d.getDate() + 1)) {
            const diaNome = diasSemanaNomes[d.getDay()];
            turmasSemana += todasTurmas.filter(t => t.dia_semana === diaNome).length;
        }

        // Professores
        const { data: professores } = await supabase
            .from('perfis')
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .eq('tipo', 'professor')
            .eq('ativo', true);

        let professoresComDados = [];

        for (const prof of (professores || [])) {
            const turmasProfessor = todasTurmas.filter(t => t.professor_id === prof.id);
            let totalAlunosProfessor = 0;

            for (const turma of turmasProfessor) {
                const { data: matriculas } = await supabase
                    .from('matriculas')
                    .select('*')
                    .eq('turma_id', turma.id)
                    .eq('ativa', true);
                totalAlunosProfessor += (matriculas || []).length;
            }

            professoresComDados.push({
                id: prof.id,
                nome: prof.nome,
                cor: prof.cor,
                totalTurmas: turmasProfessor.length,
                totalAlunos: totalAlunosProfessor,
                totalComparecimentos: 0
            });
        }

        // Turmas com dados
        let turmasComDados = [];

        for (const turma of (todasTurmas || [])) {
            const { data: matriculas } = await supabase
                .from('matriculas')
                .select('*')
                .eq('turma_id', turma.id)
                .eq('ativa', true);

            const professor = professores?.find(p => p.id === turma.professor_id);

            turmasComDados.push({
                id: turma.id,
                nome: turma.nome,
                professor_id: turma.professor_id,
                professor_nome: professor?.nome || null,
                dia_semana: turma.dia_semana,
                horario_inicio: turma.horario_inicio?.substring(0, 5) || '-',
                horario_fim: turma.horario_fim?.substring(0, 5) || '-',
                limite_alunos: turma.limite_alunos || 4,
                totalAlunos: (matriculas || []).length
            });
        }

        // Alunos que compareceram (presenças confirmadas)
        const { count: alunosComparecidos } = await supabase
            .from('presencas')
            .select('*', { count: 'exact', head: true })
            .eq('escola_id', perfil.escola_id)
            .eq('status', 'confirmado');

        res.json({
            estatisticas: {
                totalTurmas: todasTurmas?.length || 0,
                turmasSemana: turmasSemana,
                totalAulas: totalAulas,
                aulasSemana: aulasSemana,
                totalAlunos: totalAlunos || 0,
                alunosNovosMes: alunosNovosMes || 0,
                alunosComparecidos: alunosComparecidos || 0
            },
            professores: professoresComDados,
            turmas: turmasComDados
        });

    } catch (error) {
        console.error('Erro em /api/relatorios:', error);
        res.status(500).json({ error: error.message });
    }
});
// API - Buscar presenças por turma e data
app.get('/api/presencas-aula', authenticate, async (req, res) => {
    const { turma_id, data } = req.query;
    if (!turma_id || !data) {
        return res.json([]);
    }
    
    try {
        const perfil = await getPerfil(req.user.id);
        const aulaId = `${turma_id}_${data}`;
        
        const { data: presencas } = await supabase
            .from('presencas')
            .select('*, alunos(nome, telefone)')
            .eq('aula_id', aulaId)
            .eq('escola_id', perfil.escola_id);
        
        res.json(presencas || []);
    } catch (error) {
        res.json([]);
    }
});


// ==================== ROTAS DE PÁGINA ====================

app.get('/', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/index.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/dashboard', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/dashboard.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/confirmacoes', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/confirmacoes.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/alunos', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/alunos.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/professores', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/professores.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/turmas', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/turmas.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/semanal', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/semanal.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/painel', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/painel.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/relatorios', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/relatorios.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/financeiro', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/financeiro.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});

app.get('/css/style.css', (req, res) => {
    const filePath = path.resolve(__dirname, '../css/style.css');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('CSS não encontrado');
});

// Rota 404
app.use((req, res) => {
    console.log('[404] Rota não encontrada:', req.url);
    res.status(404).send('Página não encontrada');
});

app.listen(port, () => {
    console.log(`🏐 B&T Tech rodando em http://localhost:${port}`);
    console.log(`🔗 BASE_URL: ${BASE_URL}`);
});
