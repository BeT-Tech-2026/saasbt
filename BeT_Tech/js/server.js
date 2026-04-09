// server.js - Versão com ID do aluno (CORRIGIDO)
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

// API - Buscar aulas do aluno (via matrículas — cria presenças automaticamente)
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
            .select('*, turmas(id, nome, dia_semana, horario_inicio, horario_fim, escola_id)')
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

            for (let i = 0; i <= 14; i++) {
                const dataFutura = new Date(hoje);
                dataFutura.setDate(hoje.getDate() + i);

                if (diasSemana[dataFutura.getDay()] !== turma.dia_semana) continue;

                const dataStr = dataFutura.toISOString().split('T')[0];
                const aulaId  = `${turma.id}_${dataStr}`;

                const { data: presencaExistente } = await supabase
                    .from('presencas').select('id, status')
                    .eq('aula_id', aulaId).eq('aluno_id', aluno).single();

                if (presencaExistente && presencaExistente.status !== 'pendente') break;

                let presencaId = presencaExistente?.id;

                if (!presencaExistente) {
                    const { data: nova } = await supabase
                        .from('presencas')
                        .insert({
                            aula_id:   aulaId,
                            aluno_id:  aluno,
                            turma_id:  turma.id,
                            escola_id: turma.escola_id,
                            status:    'pendente'
                        })
                        .select('id').single();
                    presencaId = nova?.id;
                }

                if (!presencaId) break;

                aulas.push({
                    presenca_id:    presencaId,
                    aula_id:        aulaId,
                    turma_nome:     turma.nome,
                    data:           dataFutura.toLocaleDateString('pt-BR', {
                                        weekday: 'long', day: 'numeric', month: 'long'
                                    }),
                    data_raw:       dataStr,
                    horario_inicio: turma.horario_inicio?.substring(0, 5) || '-',
                    horario_fim:    turma.horario_fim?.substring(0, 5)    || '-',
                    status:         'pendente'
                });

                break;
            }
        }

        res.json({ success: true, dados: { aluno_nome: alunoData.nome, aulas } });

    } catch (error) {
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
        
        // ✅ CORRIGIDO: era `$https://...` (faltava as chaves)
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
                
                // ✅ CORRIGIDO: era `$https://...` (faltava as chaves)
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

app.get('/api/aulas-confirmacoes', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const hoje = new Date();
        const amanha = new Date(Date.now() + 86400000);
        const dataHoje = hoje.toISOString().split('T')[0];
        const dataAmanha = amanha.toISOString().split('T')[0];
        
        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hojeDia = diasSemana[hoje.getDay()];
        const amanhaDia = diasSemana[amanha.getDay()];
        
        const { data: turmas } = await supabase.from('turmas').select('*, perfis(nome)').eq('escola_id', perfil.escola_id).eq('ativa', true);
        
        async function getAlunosComStatus(turmaId, aulaId) {
            const { data: matriculas } = await supabase.from('matriculas').select('*, alunos(id, nome, telefone)').eq('turma_id', turmaId).eq('ativa', true);
            if (!matriculas || matriculas.length === 0) return [];
            
            const { data: presencas } = await supabase.from('presencas').select('id, aluno_id, status').eq('aula_id', aulaId);
            
            const presencasMap = {};
            if (presencas) {
                presencas.forEach(p => { presencasMap[p.aluno_id] = p; });
            }
            
            return matriculas.map(mat => {
                const conf = presencasMap[mat.aluno_id];
                return {
                    id: mat.aluno_id,
                    nome: mat.alunos?.nome,
                    telefone: mat.alunos?.telefone,
                    status: conf?.status || 'pendente',
                    // ✅ CORRIGIDO: era window.location.origin (não existe no Node.js)
                    link: `${BASE_URL}/confirmar?aluno=${mat.aluno_id}`
                };
            });
        }
        
        let aulasHoje = [];
        let aulasAmanha = [];
        let aulasProximos = [];
        
        for (const turma of (turmas || [])) {
            const aulaIdHoje = `${turma.id}_${dataHoje}`;
            const aulaIdAmanha = `${turma.id}_${dataAmanha}`;
            
            if (turma.dia_semana === hojeDia || turma.data_avulsa === dataHoje) {
                const alunos = await getAlunosComStatus(turma.id, aulaIdHoje);
                aulasHoje.push({
                    id: turma.id, nome: turma.nome, professor: turma.perfis?.nome,
                    horario_inicio: turma.horario_inicio, horario_fim: turma.horario_fim,
                    data_formatada: hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }),
                    alunos: alunos
                });
            }
            
            if (turma.dia_semana === amanhaDia || turma.data_avulsa === dataAmanha) {
                const alunos = await getAlunosComStatus(turma.id, aulaIdAmanha);
                aulasAmanha.push({
                    id: turma.id, nome: turma.nome, professor: turma.perfis?.nome,
                    horario_inicio: turma.horario_inicio, horario_fim: turma.horario_fim,
                    data_formatada: amanha.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }),
                    alunos: alunos
                });
            }
            
            for (let i = 2; i <= 6; i++) {
                const dataFutura = new Date(Date.now() + 86400000 * i);
                const dataFuturaStr = dataFutura.toISOString().split('T')[0];
                const diaFuturo = diasSemana[dataFutura.getDay()];
                
                if (turma.dia_semana === diaFuturo) {
                    const aulaId = `${turma.id}_${dataFuturaStr}`;
                    const alunos = await getAlunosComStatus(turma.id, aulaId);
                    aulasProximos.push({
                        id: turma.id, nome: turma.nome, professor: turma.perfis?.nome,
                        horario_inicio: turma.horario_inicio, horario_fim: turma.horario_fim,
                        data_formatada: dataFutura.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }),
                        alunos: alunos
                    });
                    break;
                }
            }
        }
        
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