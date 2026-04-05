require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cliente Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// ============================================
// ROTAS DE API
// ============================================

// CADASTRO
app.post('/api/cadastro', async (req, res) => {
    try {
        const { nome, email, password, nomeEscola } = req.body;

        if (!nome || !email || !password || !nomeEscola) {
            return res.status(400).json({ error: 'Preencha todos os campos' });
        }

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true
        });
        if (authError) throw authError;

        const { data: escola, error: escolaError } = await supabase
            .from('escolas')
            .insert({ nome: nomeEscola })
            .select()
            .single();
        if (escolaError) throw escolaError;

        const { data: perfil, error: perfilError } = await supabase
            .from('perfis')
            .insert({
                id: authData.user.id,
                escola_id: escola.id,
                nome: nome,
                email: email,
                tipo: 'dono'
            })
            .select()
            .single();
        if (perfilError) throw perfilError;

        res.status(201).json({ message: 'Cadastro realizado!' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const { data: perfil } = await supabase
            .from('perfis')
            .select('*, escolas(nome)')
            .eq('id', data.user.id)
            .single();

        res.json({ 
            user: data.user, 
            perfil: perfil,
            access_token: data.session?.access_token
        });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

// LOGOUT
app.post('/api/logout', async (req, res) => {
    await supabase.auth.signOut();
    res.json({ success: true });
});

// SESSION
app.get('/api/session', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase
            .from('perfis')
            .select('*, escolas(nome)')
            .eq('id', user.id)
            .single();
        res.json({ user, perfil });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

// ALUNOS
app.get('/api/alunos', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id').eq('id', user.id).single();
        
        // Alterado: Remove filtro .eq('ativo', true) para exibir todos os alunos na hora de matricular
        const { data } = await supabase.from('alunos').select('*').eq('escola_id', perfil.escola_id).order('nome');
        
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/alunos', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id').eq('id', user.id).single();
        const { nome, telefone, email } = req.body;
        const { data, error } = await supabase.from('alunos').insert({ escola_id: perfil.escola_id, nome, telefone, email }).select().single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/alunos/:id', async (req, res) => {
    await supabase.from('alunos').update({ ativo: false }).eq('id', req.params.id);
    res.json({ success: true });
});

// PROFESSORES
app.get('/api/professores', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id').eq('id', user.id).single();
        const { data } = await supabase.from('perfis').select('*').eq('escola_id', perfil.escola_id).eq('tipo', 'professor').eq('ativo', true);
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/professores', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id').eq('id', user.id).single();
        const { nome, email } = req.body;
        const { data: authData } = await supabase.auth.admin.createUser({ email, email_confirm: true, user_metadata: { nome } });
        await supabase.from('perfis').insert({ id: authData.user.id, escola_id: perfil.escola_id, nome, email, tipo: 'professor' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/professores/:id', async (req, res) => {
    await supabase.from('perfis').update({ ativo: false }).eq('id', req.params.id);
    res.json({ success: true });
});

// TURMAS
app.get('/api/turmas', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id, tipo, id').eq('id', user.id).single();
        let query = supabase.from('turmas').select('*, perfis(nome)').eq('escola_id', perfil.escola_id).eq('ativa', true);
        if (perfil.tipo === 'professor') query = query.eq('professor_id', perfil.id);
        const { data } = await query;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/turmas', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id').eq('id', user.id).single();
        
        const { nome, dia_semana, horario_inicio, horario_fim, professor_id, limite_alunos, recorrente } = req.body;
        
        const turmasToInsert = [];
        
        if (recorrente) {
            // Se for recorrente, cria uma turma para cada dia da semana
            const dias = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
            dias.forEach(dia => {
                const nomeDia = dia.charAt(0).toUpperCase() + dia.slice(1);
                turmasToInsert.push({
                    escola_id: perfil.escola_id,
                    nome: `${nome} - ${nomeDia}`,
                    dia_semana: dia,
                    horario_inicio,
                    horario_fim,
                    professor_id,
                    limite_alunos
                });
            });
        } else {
            turmasToInsert.push({
                escola_id: perfil.escola_id, 
                nome, 
                dia_semana, 
                horario_inicio, 
                horario_fim, 
                professor_id, 
                limite_alunos
            });
        }

        const { data, error } = await supabase.from('turmas').insert(turmasToInsert).select('*, perfis(nome)');
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Editar Turma
app.put('/api/turmas/:id', async (req, res) => {
    try {
        const { nome, dia_semana, horario_inicio, horario_fim, professor_id, limite_alunos } = req.body;
        
        const { data, error } = await supabase.from('turmas').update({
            nome, dia_semana, horario_inicio, horario_fim, professor_id, limite_alunos
        }).eq('id', req.params.id).select('*, perfis(nome)').single();
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/turmas/:id', async (req, res) => {
    await supabase.from('turmas').update({ ativa: false }).eq('id', req.params.id);
    res.json({ success: true });
});

// MATRÍCULAS
app.get('/api/matriculas/:turmaId', async (req, res) => {
    try {
        const { data } = await supabase.from('matriculas').select('*, alunos(*)').eq('turma_id', req.params.turmaId).eq('ativa', true);
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/matriculas', async (req, res) => {
    try {
        const { turma_id, aluno_id } = req.body;
        
        // Verificar limite
        const { data: turma } = await supabase.from('turmas').select('limite_alunos').eq('id', turma_id).single();
        const { count } = await supabase.from('matriculas').select('*', { count: 'exact', head: true }).eq('turma_id', turma_id).eq('ativa', true);
        
        if (count >= turma.limite_alunos) {
            return res.status(400).json({ error: 'Turma lotada' });
        }

        const { data, error } = await supabase.from('matriculas').insert({ turma_id, aluno_id, ativa: true }).select().single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/matriculas/:id', async (req, res) => {
    await supabase.from('matriculas').update({ ativa: false }).eq('id', req.params.id);
    res.json({ success: true });
});

// PRESENÇAS
app.get('/api/presencas/:aulaId', async (req, res) => {
    try {
        const { data } = await supabase.from('presencas').select('*, alunos(*)').eq('aula_id', req.params.aulaId);
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/presencas', async (req, res) => {
    try {
        const { aula_id, aluno_id, status } = req.body;
        const { data, error } = await supabase.from('presencas').insert({ aula_id, aluno_id, status }).select().single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/presencas/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const { data, error } = await supabase.from('presencas').update({ status }).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// AULAS
app.get('/api/aulas', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id, tipo, id').eq('id', user.id).single();
        
        const hoje = new Date().toISOString().split('T')[0];
        
        let query = supabase.from('aulas').select('*, turmas(*)').eq('data', hoje);
        if (perfil.tipo === 'professor') {
            query = supabase.from('aulas').select('*, turmas(*)').eq('data', hoje).eq('turmas.professor_id', perfil.id);
        }
        
        const { data } = await query;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/aulas', async (req, res) => {
    try {
        const { turma_id, data } = req.body;
        
        // Verificar se aula já existe
        const { data: existente } = await supabase.from('aulas').select('*').eq('turma_id', turma_id).eq('data', data).single();
        if (existente) return res.json(existente);

        const { data: aula, error } = await supabase.from('aulas').insert({ turma_id, data }).select().single();
        if (error) throw error;
        res.json(aula);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DASHBOARD
app.get('/api/dashboard', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id, tipo, id').eq('id', user.id).single();

        const [{ count: alunosAtivos }, { count: turmasAtivas }, { data: turmas }] = await Promise.all([
            supabase.from('alunos').select('*', { count: 'exact', head: true }).eq('escola_id', perfil.escola_id).eq('ativo', true),
            supabase.from('turmas').select('*', { count: 'exact', head: true }).eq('escola_id', perfil.escola_id).eq('ativa', true),
            supabase.from('turmas').select('*, perfis(nome)').eq('escola_id', perfil.escola_id).eq('ativa', true)
        ]);

        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = diasSemana[new Date().getDay()];
        let aulasHoje = turmas?.filter(t => t.dia_semana === hoje) || [];
        if (perfil.tipo === 'professor') aulasHoje = aulasHoje.filter(t => t.professor_id === perfil.id);

        res.json({ alunosAtivos, turmasAtivas, aulasHoje });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PAINEL
app.get('/api/painel', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id, tipo, id').eq('id', user.id).single();

        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = diasSemana[new Date().getDay()];

        let query = supabase.from('turmas').select('*, perfis(nome)').eq('escola_id', perfil.escola_id).eq('dia_semana', hoje).eq('ativa', true);
        if (perfil.tipo === 'professor') query = query.eq('professor_id', perfil.id);

        const { data: turmas } = await query;

        // Criar aulas de hoje se não existirem
        const dataHoje = new Date().toISOString().split('T')[0];
        for (const turma of (turmas || [])) {
            await supabase.from('aulas').upsert({ turma_id: turma.id, data: dataHoje }, { onConflict: 'turma_id,data' });
        }

        let turmasComAlunos = await Promise.all((turmas || []).map(async (turma) => {
            const { data: matriculas } = await supabase.from('matriculas').select('*, alunos(*)').eq('turma_id', turma.id).eq('ativa', true);
            return { ...turma, alunos: matriculas || [] };
        }));

        res.json(turmasComAlunos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ROTAS DE PÁGINA
// ============================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'pages', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '..', 'pages', 'dashboard.html')));
app.get('/alunos', (req, res) => res.sendFile(path.join(__dirname, '..', 'pages', 'alunos.html')));
app.get('/professores', (req, res) => res.sendFile(path.join(__dirname, '..', 'pages', 'professores.html')));
app.get('/turmas', (req, res) => res.sendFile(path.join(__dirname, '..', 'pages', 'turmas.html')));
app.get('/semanal', (req, res) => res.sendFile(path.join(__dirname, '..', 'pages', 'semanal.html')));
app.get('/painel', (req, res) => res.sendFile(path.join(__dirname, '..', 'pages', 'painel.html')));

// Arquivos estáticos
app.use('/css', express.static(path.join(__dirname, '..', 'css')));

app.listen(port, () => {
    console.log(`🏐 B&T Tech rodando em http://localhost:${port}`);
});
