require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

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



app.post('/api/cadastro', async (req, res) => {
    try {
        const { nome, email, password, nomeEscola, escola_id, tipo, cor } = req.body;

        if (!nome || !email || !password) {
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
        }

        let escolaId = escola_id;
        
        // Se não tem escola_id, busca a escola do DONO (admin)
        if (!escolaId) {
            // Busca primeiro o usuário dono para pegar a escola_id
            const { data: donoExistente } = await supabase
                .from('perfis')
                .select('escola_id')
                .eq('tipo', 'dono')
                .limit(1)
                .single();
            
            if (donoExistente) {
                escolaId = donoExistente.escola_id;
            } else {
                // Se não existe dono, cria escola padrão (para primeiro acesso)
                const { data: escola, error: escolaError } = await supabase
                    .from('escolas')
                    .insert({ nome: nomeEscola || 'Minha Escola' })
                    .select()
                    .single();
                
                if (escolaError) throw escolaError;
                escolaId = escola.id;
            }
        }

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true,
            user_metadata: { nome: nome }
        });
        if (authError) throw authError;

        const { data: perfil, error: perfilError } = await supabase
            .from('perfis')
            .insert({
                id: authData.user.id,
                escola_id: escolaId,
                nome: nome,
                email: email,
                tipo: tipo === 'dono' ? 'dono' : 'professor',
                ativo: true,
                cor: cor || '#3b82f6'
            })
            .select()
            .single();
        
        if (perfilError) throw perfilError;

        res.status(201).json({ message: 'Cadastro realizado com sucesso!', perfil });
    } catch (error) {
        console.error('Erro no cadastro:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== SISTEMA DE CONFIRMAÇÃO ====================

// 1. Buscar configuração de notificações da escola
app.get('/api/config-notificacoes', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const { data, error } = await supabase
            .from('config_notificacoes')
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .single();
        
        res.json(data || { ativo: false, horas_antes: 24 });
    } catch (error) {
        res.json({ ativo: false, horas_antes: 24 });
    }
});

// 2. Salvar configuração de notificações
app.post('/api/config-notificacoes', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { ativo, horas_antes, mensagem_personalizada } = req.body;
        
        const { data, error } = await supabase
            .from('config_notificacoes')
            .upsert({
                escola_id: perfil.escola_id,
                ativo: ativo || false,
                horas_antes: horas_antes || 24,
                mensagem_personalizada: mensagem_personalizada
            }, { onConflict: 'escola_id' })
            .select()
            .single();
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3. Status do WhatsApp
app.get('/api/whatsapp-status', async (req, res) => {
    try {
        const whatsapp = require('./whatsapp');
        res.json(whatsapp.getStatus());
    } catch (error) {
        res.json({ connected: false, error: error.message });
    }
});

// 4. Webhook para receber respostas (chamado pelo whatsapp.js)
app.post('/api/webhook-confirmacao', async (req, res) => {
    try {
        const { numero, resposta, buttonId } = req.body;
        
        // buttonId no formato: sim_turmaId_data ou nao_turmaId_data
        const [acao, turma_id, data_aula] = buttonId.split('_');
        const novoStatus = acao === 'sim' ? 'confirmado' : 'cancelado';
        
        // Busca o aluno pelo telefone
        const telefone = numero.replace(/\D/g, '');
        
        const { data: aluno } = await supabase
            .from('alunos')
            .select('id')
            .eq('telefone', `%${telefone}%`)
            .single();
        
        if (aluno) {
            const aulaId = `${turma_id}_${data_aula}`;
            
            // Atualiza mensagens_confirmacao
            await supabase
                .from('mensagens_confirmacao')
                .update({ 
                    resposta: novoStatus,
                    responded_at: new Date().toISOString()
                })
                .eq('aula_id', aulaId)
                .eq('aluno_id', aluno.id);
            
            // Atualiza presencas
            await supabase
                .from('presencas')
                .update({ 
                    status: novoStatus,
                    updated_at: new Date().toISOString()
                })
                .eq('aula_id', aulaId)
                .eq('aluno_id', aluno.id);
            
            // Envia mensagem de confirmação
            const msgResposta = novoStatus === 'confirmado'
                ? '✅ Presença confirmada! Nos vemos na aula. 🎉'
                : '❌ Aula cancelada. Que pena! Até a próxima. 🙏';
            
            const whatsapp = require('./whatsapp');
            await whatsapp.sendSimpleMessage(telefone, msgResposta);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Erro webhook:', error);
        res.status(500).json({ error: error.message });
    }
});


//---------------------------------------------------------
//---------------------------------------------------------
// 5. API para painel mostrar status de confirmação
app.get('/api/painel', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);

        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = diasSemana[new Date().getDay()];
        const dataHoje = new Date().toISOString().split('T')[0];

        const { data: turmas } = await supabase
            .from('turmas')
            .select('*, perfis(nome, cor)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true)
            .or(`dia_semana.eq.${hoje},data_avulsa.eq.${dataHoje}`);
        
        let turmasFiltradas = turmas || [];
        
        if (perfil.tipo === 'professor') {
            turmasFiltradas = turmasFiltradas.filter(t => t.professor_id === perfil.id);
        }

        let turmasComAlunos = await Promise.all((turmasFiltradas || []).map(async (turma) => {
            const { data: matriculas } = await supabase
                .from('matriculas')
                .select('*, alunos(*)')
                .eq('turma_id', turma.id)
                .eq('ativa', true);
            
            // Busca status de confirmação
            const aulaId = `${turma.id}_${turma.data_avulsa || dataHoje}`;
            const { data: presencas } = await supabase
                .from('presencas')
                .select('*')
                .eq('aula_id', aulaId);
            
            // Mescla status da presença
            const alunos = (matriculas || []).map(m => {
                const presenca = presencas?.find(p => p.aluno_id === m.aluno_id);
                return {
                    ...m,
                    status_confirmacao: presenca?.status || 'pendente'
                };
            });
            
            return { ...turma, alunos };
        }));

        res.json(turmasComAlunos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
//---------------------------------------------------------



app.get('/api/escolas', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('escolas')
            .select('id, nome')
            .order('nome');
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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

        res.json({ 
            user: data.user, 
            perfil: perfil,
            access_token: data.session.access_token
        });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

app.post('/api/logout', async (req, res) => {
    await supabase.auth.signOut();
    res.json({ success: true });
});

app.get('/api/session', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        res.json({ user: req.user, perfil });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

app.get('/api/alunos', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const { data: alunos } = await supabase
            .from('alunos')
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .eq('ativo', true)
            .order('nome');
        
        const alunosComTurmas = await Promise.all((alunos || []).map(async (aluno) => {
            const { data: matriculas } = await supabase
                .from('matriculas')
                .select('*, turmas(nome)')
                .eq('aluno_id', aluno.id)
                .eq('ativa', true);
            
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
        
        const { data, error } = await supabase
            .from('alunos')
            .insert({ escola_id: perfil.escola_id, nome, telefone, email })
            .select()
            .single();
        
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
        
        const { data: alunoExistente } = await supabase
            .from('alunos')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!alunoExistente || alunoExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { data, error } = await supabase
            .from('alunos')
            .update({ nome, telefone, email })
            .eq('id', req.params.id)
            .select()
            .single();
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/alunos/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const { data: alunoExistente } = await supabase
            .from('alunos')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!alunoExistente || alunoExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        await supabase.from('alunos').update({ ativo: false }).eq('id', req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/professores', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (perfil.tipo === 'professor') {
            const { data } = await supabase.from('perfis').select('*').eq('id', req.user.id);
            return res.json(data || []);
        }
        
        const { data } = await supabase
            .from('perfis')
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .eq('tipo', 'professor')
            .eq('ativo', true);
        
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
            email: email,
            password: senha,
            email_confirm: true,
            user_metadata: { nome: nome }
        });
        
        if (authError) throw authError;

        const { error: perfilError } = await supabase.from('perfis').insert({
            id: authData.user.id,
            escola_id: perfil.escola_id,
            nome: nome,
            email: email,
            tipo: 'professor',
            ativo: true,
            cor: cor || '#3b82f6'
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
        
        const { data: professorExistente } = await supabase
            .from('perfis')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!professorExistente || professorExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        await supabase.from('perfis').update({ ativo: false }).eq('id', req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/turmas', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        // Busca todas as turmas ativas da escola
        const { data: turmas, error } = await supabase
            .from('turmas')
            .select('*, perfis(nome, cor)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);
        
        if (error) throw error;
        
        // Se for professor, filtra apenas as turmas dele
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
                escola_id: perfil.escola_id,
                nome: t.nome,
                dia_semana: t.dia_semana,
                horario_inicio: t.horario_inicio,
                horario_fim: t.horario_fim,
                professor_id: t.professor_id || null,
                limite_alunos: t.limite_alunos || 4,
                ativa: true,
                data_avulsa: t.data_avulsa || null
            }));
            
            const { data, error } = await supabase.from('turmas').insert(turmasFormatadas).select('*, perfis(nome, cor)');
            if (error) throw error;
            return res.json(data);
        }
        
        const turmaUnica = {
            escola_id: perfil.escola_id,
            nome: nome,
            dia_semana: dia_semana,
            horario_inicio,
            horario_fim,
            professor_id: professor_id || null,
            limite_alunos: limite_alunos || 4,
            ativa: true,
            data_avulsa: data_avulsa || null
        };
        
        const { data, error } = await supabase
            .from('turmas')
            .insert(turmaUnica)
            .select('*, perfis(nome, cor)')
            .single();
        
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
        
        const { data: turmaExistente } = await supabase
            .from('turmas')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!turmaExistente || turmaExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { data, error } = await supabase
            .from('turmas')
            .update({ nome, dia_semana, horario_inicio, horario_fim, professor_id, limite_alunos, data_avulsa })
            .eq('id', req.params.id)
            .select('*, perfis(nome, cor)')
            .single();
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/turmas/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const { data: turmaExistente } = await supabase
            .from('turmas')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!turmaExistente || turmaExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        await supabase.from('turmas').update({ ativa: false }).eq('id', req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/matriculas/:turmaId', authenticate, async (req, res) => {
    try {
        const { data } = await supabase
            .from('matriculas')
            .select('*, alunos(*)')
            .eq('turma_id', req.params.turmaId)
            .eq('ativa', true);
        
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/matriculas', authenticate, async (req, res) => {
    try {
        const { turma_id, aluno_id } = req.body;
        
        const { data: turma } = await supabase
            .from('turmas')
            .select('limite_alunos')
            .eq('id', turma_id)
            .single();
        
        const { count } = await supabase
            .from('matriculas')
            .select('*', { count: 'exact', head: true })
            .eq('turma_id', turma_id)
            .eq('ativa', true);
        
        if (count >= turma.limite_alunos) {
            return res.status(400).json({ error: 'Turma lotada' });
        }

        const { data: existente } = await supabase
            .from('matriculas')
            .select('*')
            .eq('turma_id', turma_id)
            .eq('aluno_id', aluno_id)
            .eq('ativa', true)
            .single();
        
        if (existente) {
            return res.status(400).json({ error: 'Aluno já matriculado nesta turma' });
        }

        const { data, error } = await supabase
            .from('matriculas')
            .insert({ turma_id, aluno_id, ativa: true })
            .select()
            .single();
        
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

app.get('/api/presencas/:aulaId', authenticate, async (req, res) => {
    try {
        const { data } = await supabase
            .from('presencas')
            .select('*, alunos(*)')
            .eq('aula_id', req.params.aulaId);
        
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/presencas', authenticate, async (req, res) => {
    try {
        const { aula_id, aluno_id, status } = req.body;
        
        const { data: existente } = await supabase
            .from('presencas')
            .select('*')
            .eq('aula_id', aula_id)
            .eq('aluno_id', aluno_id)
            .single();
        
        if (existente) {
            const { data, error } = await supabase
                .from('presencas')
                .update({ status })
                .eq('id', existente.id)
                .select()
                .single();
            
            if (error) throw error;
            return res.json(data);
        }

        const { data, error } = await supabase
            .from('presencas')
            .insert({ aula_id, aluno_id, status })
            .select()
            .single();
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/presencas/:id', authenticate, async (req, res) => {
    try {
        const { status } = req.body;
        const { data, error } = await supabase
            .from('presencas')
            .update({ status })
            .eq('id', req.params.id)
            .select()
            .single();
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/aulas', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const hoje = new Date().toISOString().split('T')[0];
        
        // Busca as turmas primeiro
        const { data: turmas } = await supabase
            .from('turmas')
            .select('*, perfis(nome, cor)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);
        
        let turmasFiltradas = turmas || [];
        
        // Se for professor, filtra apenas as turmas dele
        if (perfil.tipo === 'professor') {
            turmasFiltradas = turmasFiltradas.filter(t => t.professor_id === perfil.id);
        }
        
        const turmaIds = turmasFiltradas.map(t => t.id);
        
        if (turmaIds.length === 0) {
            return res.json([]);
        }
        
        // Busca aulas do dia para essas turmas
        const { data: aulas } = await supabase
            .from('aulas')
            .select('*, turmas(*)')
            .eq('data', hoje)
            .in('turma_id', turmaIds);
        
        res.json(aulas || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/aulas', authenticate, async (req, res) => {
    try {
        const { turma_id, data } = req.body;
        
        const { data: existente } = await supabase
            .from('aulas')
            .select('*')
            .eq('turma_id', turma_id)
            .eq('data', data)
            .single();
        
        if (existente) return res.json(existente);

        const { data: aula, error } = await supabase
            .from('aulas')
            .insert({ turma_id, data })
            .select()
            .single();
        
        if (error) throw error;
        res.json(aula);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/aulas/buscar', authenticate, async (req, res) => {
    try {
        const { turma_id, data } = req.query;
        const { data: aula } = await supabase
            .from('aulas')
            .select('*')
            .eq('turma_id', turma_id)
            .eq('data', data)
            .single();
        
        res.json(aula || null);
    } catch (error) {
        res.json(null);
    }
});

app.get('/api/dashboard', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);

        const [{ count: alunosAtivos }, { count: turmasAtivas }, { data: turmas }] = await Promise.all([
            supabase.from('alunos').select('*', { count: 'exact', head: true }).eq('escola_id', perfil.escola_id).eq('ativo', true),
            supabase.from('turmas').select('*', { count: 'exact', head: true }).eq('escola_id', perfil.escola_id).eq('ativa', true),
            supabase.from('turmas').select('*, perfis(nome, cor)').eq('escola_id', perfil.escola_id).eq('ativa', true)
        ]);

        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = diasSemana[new Date().getDay()];
        const dataHoje = new Date().toISOString().split('T')[0];
        
        let aulasHoje = turmas?.filter(t => t.dia_semana === hoje || t.data_avulsa === dataHoje) || [];
        
        if (perfil.tipo === 'professor') {
            aulasHoje = aulasHoje.filter(t => t.professor_id === perfil.id);
        }

        res.json({ alunosAtivos, turmasAtivas, aulasHoje });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// CONFIGURAÇÕES FINANCEIRAS
app.get('/api/config-financeiras', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const { data, error } = await supabase
            .from('configuracoes_financeiras')
            .select('*')
            .eq('escola_id', perfil.escola_id);
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/config-financeiras', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { tipo, valor, quantidade, descricao } = req.body;
        
        // Remove registros antigos desse tipo antes de inserir novo
        if (tipo === 'mensalidade_fixa' || tipo === 'mensalidade_variavel') {
            await supabase
                .from('configuracoes_financeiras')
                .delete()
                .eq('escola_id', perfil.escola_id)
                .eq('tipo', tipo);
        }
        
        const { data, error } = await supabase
            .from('configuracoes_financeiras')
            .insert({
                escola_id: perfil.escola_id,
                tipo,
                valor: parseFloat(valor),
                quantidade: quantidade || 1,
                descricao
            })
            .select()
            .single();
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/config-financeiras/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        const { data: existing } = await supabase
            .from('configuracoes_financeiras')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!existing || existing.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        await supabase
            .from('configuracoes_financeiras')
            .delete()
            .eq('id', req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


//rota /api/relatorios 

app.get('/api/relatorios', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        const { inicio, fim } = req.query;

        // Se não tiver período, usa o mês atual
        const periodoInicio = inicio ? new Date(inicio) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const periodoFim = fim ? new Date(fim) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);

        // 1. Buscar turmas
        const { data: turmas } = await supabase
            .from('turmas')
            .select('*, perfis(nome, cor)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);

        // 2. Buscar alunos
        const { data: alunos } = await supabase
            .from('alunos')
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .eq('ativo', true);

        // 3. Buscar matrículas
        const { data: matriculas } = await supabase
            .from('matriculas')
            .select('*, alunos(nome), turmas(professor_id)')
            .eq('ativa', true);

        // 4. Buscar aulas no período
        const { data: aulas } = await supabase
            .from('aulas')
            .select('id, turma_id, data')
            .gte('data', periodoInicio.toISOString().split('T')[0])
            .lte('data', periodoFim.toISOString().split('T')[0]);

        // 5. Buscar presenças dessas aulas
        let presencas = [];
        if (aulas && aulas.length > 0) {
            const aulaIds = aulas.map(a => a.id);
            const { data: presencasData } = await supabase
                .from('presencas')
                .select('id, aula_id, aluno_id, status')
                .in('aula_id', aulaIds);
            
            presencas = presencasData || [];
        }

        // Calcular alunos comparecidos (contando aparições, não alunos únicos)
        // Considera "presente" ou "confirmado" como comparecimento
        const comparecimentosCount = presencas.filter(p => 
            p.status === 'presente' || p.status === 'confirmado'
        ).length;

        // Professores
        const professoresMap = {};
        
        for (const turma of (turmas || [])) {
            const professorId = turma.professor_id;
            if (!professorId) continue;
            
            if (!professoresMap[professorId]) {
                professoresMap[professorId] = {
                    id: professorId,
                    nome: turma.perfis?.nome || 'Sem professor',
                    cor: turma.perfis?.cor || '#3b82f6',
                    totalTurmas: 0,
                    totalAlunos: 0,
                    totalComparecimentos: 0,
                    aulasMes: 0
                };
            }
        }

        // Calcular estatísticas por professor
        const turmasIds = turmas?.map(t => t.id) || [];
        const turmasPorProfessor = {};
        
        turmas?.forEach(t => {
            if (t.professor_id) {
                if (!turmasPorProfessor[t.professor_id]) {
                    turmasPorProfessor[t.professor_id] = [];
                }
                turmasPorProfessor[t.professor_id].push(t);
            }
        });

        Object.keys(professoresMap).forEach(profId => {
            const turmasProf = turmasPorProfessor[profId] || [];
            professoresMap[profId].totalTurmas = turmasProf.length;
            
            // Alunos únicos nas turmas do professor
            const matriculasProf = matriculas?.filter(m => 
                m.turmas?.professor_id === profId
            ) || [];
            const alunosUnicos = [...new Set(matriculasProf.map(m => m.aluno_id))];
            professoresMap[profId].totalAlunos = alunosUnicos.length;
            
            // Aulas do professor no período
            const aulasProfIds = [];
            turmasProf.forEach(t => {
                const aulasDaTurma = aulas?.filter(a => a.turma_id === t.id) || [];
                aulasDaTurma.forEach(a => aulasProfIds.push(a.id));
            });

            // Comparecimentos do professor
            const comparecimentosProf = presencas.filter(p => 
                aulasProfIds.includes(p.aula_id) && 
                (p.status === 'presente' || p.status === 'confirmado')
            ).length;
            
            professoresMap[profId].totalComparecimentos = comparecimentosProf;
            professoresMap[profId].aulasMes = turmasProf.length * 4;
        });

        // Turmas com alunos
        const turmasComAlunos = turmas?.map(turma => {
            const alunosTurma = matriculas?.filter(m => m.turma_id === turma.id) || [];
            return { 
                ...turma, 
                professor_nome: turma.perfis?.nome, 
                totalAlunos: alunosTurma.length 
            };
        }) || [];

        // Estatísticas gerais
        const totalTurmas = turmas?.length || 0;
        const totalAlunos = alunos?.length || 0;
        
        // Contar alunos novos no período
        const alunosNovosPeriodo = alunos?.filter(a => 
            new Date(a.created_at) >= periodoInicio && new Date(a.created_at) <= periodoFim
        ).length || 0;

        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = diasSemana[new Date().getDay()];
        const dataHoje = new Date().toISOString().split('T')[0];
        
        // Turmas/Aulas desta semana
        const turmasSemana = turmas?.filter(t => t.dia_semana === hoje).length || 0;
        const aulasSemana = turmasSemana * 4;
        
        const totalAulas = aulas?.length || 0;
        const mediaPresenca = totalAulas > 0 ? (comparecimentosCount / totalAulas).toFixed(1) : 0;

        res.json({
            estatisticas: {
                totalTurmas,
                turmasSemana,
                totalAlunos,
                alunosNovosMes: alunosNovosPeriodo,
                totalAulas,
                aulasSemana,
                alunosComparecidos: comparecimentosCount,
                mediaPresenca: parseFloat(mediaPresenca)
            },
            professores: Object.values(professoresMap),
            turmas: turmasComAlunos
        });
    } catch (error) {
        console.error('Erro relatórios:', error);
        res.status(500).json({ error: error.message });
    }
});


app.get('/api/painel', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);

        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = diasSemana[new Date().getDay()];
        const dataHoje = new Date().toISOString().split('T')[0];

        // Busca as turmas primeiro
        const { data: turmas } = await supabase
            .from('turmas')
            .select('*, perfis(nome, cor)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true)
            .or(`dia_semana.eq.${hoje},data_avulsa.eq.${dataHoje}`);
        
        let turmasFiltradas = turmas || [];
        
        // Se for professor, filtra apenas as turmas dele
        if (perfil.tipo === 'professor') {
            turmasFiltradas = turmasFiltradas.filter(t => t.professor_id === perfil.id);
        }

        for (const turma of (turmasFiltradas || [])) {
            await supabase
                .from('aulas')
                .upsert({ turma_id: turma.id, data: dataHoje }, { onConflict: 'turma_id,data' });
        }

        let turmasComAlunos = await Promise.all((turmasFiltradas || []).map(async (turma) => {
            const { data: matriculas } = await supabase
                .from('matriculas')
                .select('*, alunos(*)')
                .eq('turma_id', turma.id)
                .eq('ativa', true);
            
            return { ...turma, alunos: matriculas || [] };
        }));

        res.json(turmasComAlunos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ROTAS DE PÁGINA
const fs = require('fs');

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
    else res.status(404).send('Arquivo não encontrado: ' + filePath);
});

app.get('/financeiro', (req, res) => {
    const filePath = path.resolve(__dirname, '../pages/financeiro.html');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Arquivo não encontrado');
});


// CSS
app.get('/css/style.css', (req, res) => {
    const filePath = path.resolve(__dirname, '../css/style.css');
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('CSS não encontrado');
});

app.listen(port, () => {
    console.log(`🏐 B&T Tech rodando em http://localhost:${port}`);
});
