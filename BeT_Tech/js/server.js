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

        if (!perfil) {
            await supabase.auth.signOut();
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

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
        
        const { data } = await supabase.from('alunos').select('*').eq('escola_id', perfil.escola_id).eq('ativo', true).order('nome');
        
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

// ALUNOS - EDITAR
app.put('/api/alunos/:id', async (req, res) => {
    try {
        const { nome, telefone, email } = req.body;
        
        const { data, error } = await supabase.from('alunos').update({
            nome, telefone, email
        }).eq('id', req.params.id).select().single();
        
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

// PROFESSORES - GET (listar)
app.get('/api/professores', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        
        const { data: perfilAtual } = await supabase.from('perfis').select('escola_id, tipo').eq('id', user.id).single();
        
        if (perfilAtual.tipo === 'professor') {
            const { data } = await supabase.from('perfis').select('*').eq('id', user.id);
            return res.json(data || []);
        }
        
        const { data } = await supabase.from('perfis').select('*').eq('escola_id', perfilAtual.escola_id).eq('tipo', 'professor').eq('ativo', true);
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PROFESSORES - POST (criar)
app.post('/api/professores', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        const { data: perfil } = await supabase.from('perfis').select('escola_id').eq('id', user.id).single();
        
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

        const { data: novoPerfil, error: perfilError } = await supabase.from('perfis').insert({
            id: authData.user.id,
            escola_id: perfil.escola_id,
            nome: nome,
            email: email,
            tipo: 'professor',
            ativo: true,
            cor: cor || '#3b82f6' // Cor padrão azul se não for informada
        }).select().single();
        
        if (perfilError) throw perfilError;

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
        
        // Alterado para buscar 'cor' do professor
        let query = supabase.from('turmas').select('*, perfis(nome, cor)').eq('escola_id', perfil.escola_id).eq('ativa', true);
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
        
        const { turmas, nome, dia_semana, horario_inicio, horario_fim, professor_id, limite_alunos, data_avulsa } = req.body;
        
        // Se for array de turmas (múltiplos dias)
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
            
            // Alterado para buscar 'cor' do professor
            const { data, error } = await supabase.from('turmas').insert(turmasFormatadas).select('*, perfis(nome, cor)');
            if (error) throw error;
            return res.json(data);
        }
        
        // Se for uma única turma (aula avulsa ou edição)
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
        
        // Alterado para buscar 'cor' do professor
        const { data, error } = await supabase.from('turmas').insert(turmaUnica).select('*, perfis(nome, cor)').single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/turmas/:id', async (req, res) => {
    try {
        const { nome, dia_semana, horario_inicio, horario_fim, professor_id, limite_alunos, data_avulsa } = req.body;
        
        // Alterado para buscar 'cor' do professor
        const { data, error } = await supabase.from('turmas').update({
            nome, 
            dia_semana, 
            horario_inicio, 
            horario_fim, 
            professor_id, 
            limite_alunos,
            data_avulsa
        }).eq('id', req.params.id).select('*, perfis(nome, cor)').single();
        
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
            // Alterado para buscar 'cor' do professor
            supabase.from('turmas').select('*, perfis(nome, cor)').eq('escola_id', perfil.escola_id).eq('ativa', true)
        ]);

        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hoje = diasSemana[new Date().getDay()];
        const dataHoje = new Date().toISOString().split('T')[0];
        
        let aulasHoje = turmas?.filter(t => {
            return t.dia_semana === hoje || t.data_avulsa === dataHoje;
        }) || [];
        
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
        const dataHoje = new Date().toISOString().split('T')[0];

        // Alterado para buscar 'cor' do professor
        let query = supabase.from('turmas')
            .select('*, perfis(nome, cor)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true)
            .or(`dia_semana.eq.${hoje},data_avulsa.eq.${dataHoje}`);
            
        if (perfil.tipo === 'professor') query = query.eq('professor_id', perfil.id);

        const { data: turmas } = await query;

        // Cria aulas para hoje
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

require('dotenv').config();

console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('PORT:', process.env.PORT);


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

app.use('/css', express.static(path.join(__dirname, '..', 'css')));

app.listen(port, () => {
    console.log(`🏐 B&T Tech rodando em http://localhost:${port}`);
});
