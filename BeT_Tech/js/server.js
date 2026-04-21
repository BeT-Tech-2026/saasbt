// server.js - B&T Tech (CORRIGIDO)
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS - Adicionar para permitir requisições do frontend
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Validação das variáveis de ambiente
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERRO: Variáveis de ambiente SUPABASE_URL e SUPABASE_KEY não definidas!');
    console.log('Verifique seu arquivo .env');
    process.exit(1);
}

console.log('✅ Supabase URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

const BASE_URL = (process.env.BASE_URL || '').trim() || 'https://saasbt.vercel.app';

console.log('🔧 Servidor iniciando...');
console.log('📍 BASE_URL:', BASE_URL);
console.log('📂 __dirname:', __dirname);

// ==================== AUTENTICAÇÃO ====================
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        const token = authHeader.replace('Bearer ', '');
        
        // CORREÇÃO: Usar getUser() sem parâmetros (usa a sessão atual)
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            console.error('❌ Erro na autenticação:', error);
            return res.status(401).json({ error: 'Token inválido' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('❌ Erro no middleware de autenticação:', error);
        res.status(401).json({ error: 'Token inválido' });
    }
};

const getPerfil = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('perfis')
            .select('*, escolas(nome)')
            .eq('id', userId)
            .single();
        
        if (error) {
            console.error('❌ Erro ao buscar perfil:', error);
            return null;
        }
        return data;
    } catch (error) {
        console.error('❌ Erro ao buscar perfil:', error);
        return null;
    }
};

// ==================== ROTAS PÚBLICAS ====================

app.get('/confirmar', (req, res) => {
    console.log('>>> Acessando /confirmar');
    console.log('>>> Query:', req.query);
    
    const possiveisCaminhos = [
        path.join(__dirname, 'pages', 'confirmar.html'),
        path.join(__dirname, '..', 'pages', 'confirmar.html'),
        path.join(process.cwd(), 'pages', 'confirmar.html'),
        path.join(process.cwd(), 'src', 'pages', 'confirmar.html'),
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
        <p><strong>Process CWD:</strong> ${process.cwd()}</p>
    `);
});

// ==================== ROTAS DE AUTENTICAÇÃO ====================

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios' });
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) {
            console.error('❌ Erro no login:', error);
            return res.status(401).json({ error: error.message });
        }

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
        console.error('❌ Erro no login:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/logout', async (req, res) => {
    try {
        await supabase.auth.signOut();
        res.json({ success: true });
    } catch (error) {
        res.json({ success: true }); // Sempre retorna sucesso no logout
    }
});

app.post('/api/cadastro', async (req, res) => {
    try {
        const { nome, email, password, nomeEscola, escola_id, tipo, cor } = req.body;
        
        if (!nome || !email || !password) {
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
        }

        let escolaId = escola_id;
        
        if (!escolaId) {
            const { data: donoExistente } = await supabase
                .from('perfis')
                .select('escola_id')
                .eq('tipo', 'dono')
                .limit(1)
                .single();
            
            if (donoExistente) {
                escolaId = donoExistente.escola_id;
            } else {
                const { data: escola, error: escolaError } = await supabase
                    .from('escolas')
                    .insert({ nome: nomeEscola || 'Minha Escola' })
                    .select()
                    .single();
                
                if (escolaError) throw escolaError;
                escolaId = escola.id;
            }
        }

        // CORREÇÃO: Usar API pública para criar usuário (com email_confirm: false)
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true,
            user_metadata: { nome: nome }
        });
        
        if (authError) {
            console.error('❌ Erro ao criar usuário:', authError);
            throw authError;
        }

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
        console.error('❌ Erro no cadastro:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/session', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        if (!perfil) {
            return res.status(404).json({ error: 'Perfil não encontrado' });
        }
        res.json({ user: req.user, perfil });
    } catch (error) {
        console.error('❌ Erro na sessão:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/escolas', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('escolas')
            .select('id, nome')
            .order('nome');
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('❌ Erro ao buscar escolas:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE ALUNOS ====================

app.get('/api/alunos', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        // OTIMIZAÇÃO: Consulta única com JOIN em vez de N+1 queries
        const { data: alunos, error } = await supabase
            .from('alunos')
            .select('*, matriculas(ativa, turmas(nome))')
            .eq('escola_id', perfil.escola_id)
            .eq('ativo', true)
            .order('nome');
        
        if (error) throw error;
        
        // Processa no servidor para evitar processamento no cliente
        const alunosComTurmas = (alunos || []).map((aluno) => {
            const turmas = aluno.matriculas
                ?.filter(m => m.ativa && m.turmas)
                ?.map(m => m.turmas.nome) || [];
            const { matriculas, ...alunoSemMatriculas } = aluno;
            return { ...alunoSemMatriculas, turmas };
        });
        
        res.json(alunosComTurmas);
    } catch (error) {
        console.error('❌ Erro ao buscar alunos:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/alunos', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        const { nome, telefone, email } = req.body;
        
        if (!nome) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }

        const { data, error } = await supabase
            .from('alunos')
            .insert({ 
                escola_id: perfil.escola_id, 
                nome, 
                telefone, 
                email 
            })
            .select()
            .single();
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('❌ Erro ao criar aluno:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/alunos/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

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
        console.error('❌ Erro ao atualizar aluno:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/alunos/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        const { data: alunoExistente } = await supabase
            .from('alunos')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!alunoExistente || alunoExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { error } = await supabase
            .from('alunos')
            .update({ ativo: false })
            .eq('id', req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Erro ao excluir aluno:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE PROFESSORES ====================

app.get('/api/professores', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        if (perfil.tipo === 'professor') {
            const { data } = await supabase
                .from('perfis')
                .select('*')
                .eq('id', req.user.id);
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
        console.error('❌ Erro ao buscar professores:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/professores', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { nome, email, senha, cor } = req.body;
        
        if (!nome || !email || !senha) {
            return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
        }

        if (senha.length < 6) {
            return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
        }

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: email,
            password: senha,
            email_confirm: true,
            user_metadata: { nome: nome }
        });
        
        if (authError) throw authError;

        const { error: perfilError } = await supabase
            .from('perfis')
            .insert({
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
        console.error('❌ Erro ao criar professor:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/professores/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

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

        if (senha && senha.length >= 6) {
            const { error: senhaError } = await supabase.auth.admin.updateUserById(
                req.params.id,
                { password: senha }
            );
            if (senhaError) {
                console.error('⚠️ Erro ao atualizar senha:', senhaError);
            }
        }

        if (Object.keys(updates).length > 0) {
            const { data, error } = await supabase
                .from('perfis')
                .update(updates)
                .eq('id', req.params.id)
                .select('id, nome, email, cor')
                .single();
            
            if (error) throw error;
            res.json({ success: true, professor: data });
        } else {
            res.json({ success: true, message: 'Nenhuma alteração realizada' });
        }
    } catch (error) {
        console.error('❌ Erro ao atualizar professor:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/professores/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { data: professorExistente } = await supabase
            .from('perfis')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!professorExistente || professorExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { error } = await supabase
            .from('perfis')
            .update({ ativo: false })
            .eq('id', req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Erro ao excluir professor:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE TURMAS ====================

app.get('/api/turmas', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        const { data: turmas, error } = await supabase
            .from('turmas')
            .select('*, perfis(nome, cor)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);
        
        if (error) throw error;

        if (perfil.tipo === 'professor') {
            const turmasDoProfessor = (turmas || []).filter(t => t.professor_id === perfil.id);
            return res.json(turmasDoProfessor);
        }

        res.json(turmas || []);
    } catch (error) {
        console.error('❌ Erro ao buscar turmas:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/turmas', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

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

            const { data, error } = await supabase
                .from('turmas')
                .insert(turmasFormatadas)
                .select('*, perfis(nome, cor)');
            
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
        console.error('❌ Erro ao criar turma:', error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/turmas/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

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
        console.error('❌ Erro ao atualizar turma:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/turmas/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        const { data: turmaExistente } = await supabase
            .from('turmas')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!turmaExistente || turmaExistente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const { error } = await supabase
            .from('turmas')
            .update({ ativa: false })
            .eq('id', req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Erro ao excluir turma:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE MATRÍCULAS ====================

app.get('/api/matriculas/:turmaId', authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('matriculas')
            .select('*, alunos(*)')
            .eq('turma_id', req.params.turmaId)
            .eq('ativa', true);
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('❌ Erro ao buscar matrículas:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/matriculas', authenticate, async (req, res) => {
    try {
        const { turma_id, aluno_id } = req.body;
        
        if (!turma_id || !aluno_id) {
            return res.status(400).json({ error: 'turma_id e aluno_id são obrigatórios' });
        }

        const { data: turma } = await supabase
            .from('turmas')
            .select('limite_alunos')
            .eq('id', turma_id)
            .single();
        
        if (!turma) {
            return res.status(404).json({ error: 'Turma não encontrada' });
        }

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
        console.error('❌ Erro ao criar matrícula:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/matriculas/:id', authenticate, async (req, res) => {
    try {
        const { error } = await supabase
            .from('matriculas')
            .update({ ativa: false })
            .eq('id', req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Erro ao excluir matrícula:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE CONFIRMAÇÃO ====================

app.get('/api/aulas-aluno', async (req, res) => {
    const { aluno } = req.query;
    if (!aluno) return res.json({ success: false, error: 'ID do aluno não fornecido' });

    try {
        const { data: alunoData, error: alunoError } = await supabase
            .from('alunos')
            .select('nome')
            .eq('id', aluno)
            .single();
        
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
                const aulaId = `${turma.id}_${dataStr}`;

                const { data: presencaExistente } = await supabase
                    .from('presencas')
                    .select('id, status')
                    .eq('aula_id', aulaId)
                    .eq('aluno_id', aluno)
                    .single();

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
                        .select('id')
                        .single();
                    presencaId = nova?.id;
                }

                if (!presencaId) break;

                aulas.push({
                    presenca_id: presencaId,
                    aula_id: aulaId,
                    turma_nome: turma.nome,
                    data: dataAulaValida.toLocaleDateString('pt-BR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long'
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
        console.error('❌ Erro em aulas-aluno:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/confirmar-presenca', async (req, res) => {
    const { presenca_id, status } = req.body;
    
    if (!presenca_id) {
        return res.json({ success: false, error: 'ID da presença não fornecido' });
    }
    
    const { error } = await supabase
        .from('presencas')
        .update({ status: status || 'confirmado', updated_at: new Date().toISOString() })
        .eq('id', presenca_id);
    
    if (error) {
        return res.json({ success: false, error: error.message });
    }
    
    res.json({ success: true });
});

app.post('/api/gerar-link-unico', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

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
        
        const { data: turma } = await supabase
            .from('turmas')
            .select('*')
            .eq('id', turma_id)
            .single();
        
        if (!turma) {
            return res.status(400).json({ error: 'Turma não encontrada' });
        }
        
        const dataAula = data || turma.data_avulsa || (turma.dia_semana === hojeDia ? dataHoje : dataAmanha);
        const aulaId = `${turma_id}_${dataAula}`;
        
        const linkConfirmacao = `${BASE_URL}/confirmar?aluno=${aluno_id}`;
        
        const { error: presencaError } = await supabase
            .from('presencas')
            .upsert({
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
        
        console.log('✅ Link gerado:', linkConfirmacao);
        res.json({ success: true, link: linkConfirmacao });
    } catch (error) {
        console.error('❌ Erro ao gerar link:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/gerar-links-confirmacao', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }
        
        const hoje = new Date();
        const amanha = new Date(Date.now() + 86400000);
        const dataHoje = hoje.toISOString().split('T')[0];
        const dataAmanha = amanha.toISOString().split('T')[0];
        
        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hojeDia = diasSemana[hoje.getDay()];
        const amanhaDia = diasSemana[amanha.getDay()];
        
        const { data: turmas } = await supabase
            .from('turmas')
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);
        
        const turmasFiltradas = (turmas || []).filter(t => 
            t.dia_semana === hojeDia || t.dia_semana === amanhaDia ||
            t.data_avulsa === dataHoje || t.data_avulsa === dataAmanha
        );
        
        let links = [];
        
        for (const turma of turmasFiltradas) {
            const { data: matriculas } = await supabase
                .from('matriculas')
                .select('*, alunos(*)')
                .eq('turma_id', turma.id)
                .eq('ativa', true);
            
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
                
                const mensagem = `Confirmacao de Aula\n\nOla ${mat.alunos.nome}!\n\nAula: ${turma.nome}\nData: ${dataFormatada}\nHorario: ${horario}\n\nConfirme sua presenca:\n${linkConfirmacao}\n\nB&T Tech`;
                
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
        console.error('❌ Erro ao gerar links:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/aulas-confirmacoes', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }
        
        const agora = new Date();
        const offset = -3 * 60;
        const hoje = new Date(agora.getTime() + agora.getTimezoneOffset() * 60000 + offset * 60000);
        const dataHoje = hoje.toISOString().split('T')[0];
        
        const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const hojeDia = diasSemana[hoje.getDay()];
        
        const { data: turmas } = await supabase
            .from('turmas')
            .select('*, perfis(nome)')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);
        
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
            const dataAvulsaStr = turma.data_avulsa;
            
            if (dataAvulsaStr) {
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
            
            const amanhaDate = new Date();
            amanhaDate.setDate(amanhaDate.getDate() + 1);
            const dataAmanha = amanhaDate.toISOString().split('T')[0];
            
            const aulaId = `${turma.id}_${dataStr}`;
            const alunos = await getAlunosComStatus(turma.id, aulaId);
            
            const ehHoje = dataStr === dataHoje;
            const ehAmanha = dataStr === dataAmanha;
            
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
        
        res.json({ hoje: aulasHoje, amanha: aulasAmanha, proximos: aulasProximos });
        
    } catch (error) {
        console.error('❌ Erro em aulas-confirmacoes:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS DE PAINEL E DASHBOARD ====================

app.get('/api/painel', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

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
            
            const aulaId = `${turma.id}_${turma.data_avulsa || dataHoje}`;
            const { data: presencas } = await supabase
                .from('presencas')
                .select('*')
                .eq('aula_id', aulaId);
            
            const alunos = (matriculas || []).map(m => {
                const presenca = presencas?.find(p => p.aluno_id === m.aluno_id);
                return { ...m, status_confirmacao: presenca?.status || 'pendente' };
            });
            
            return { ...turma, alunos };
        }));

        res.json(turmasComAlunos);
    } catch (error) {
        console.error('❌ Erro no painel:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/dashboard', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }
        
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
        console.error('❌ Erro no dashboard:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTAS FINANCEIRAS ====================

app.get('/api/config-financeiras', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const { data, error } = await supabase
            .from('configuracoes_financeiras')
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('❌ Erro ao buscar config financeiras:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/config-financeiras', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const { tipo, valor, quantidade, descricao } = req.body;
        
        const { data, error } = await supabase
            .from('configuracoes_financeiras')
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
        console.error('❌ Erro ao criar config financeira:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/config-financeiras/:id', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        if (perfil.tipo !== 'dono') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const { data: existente } = await supabase
            .from('configuracoes_financeiras')
            .select('escola_id')
            .eq('id', req.params.id)
            .single();
        
        if (!existente || existente.escola_id !== perfil.escola_id) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const { error } = await supabase
            .from('configuracoes_financeiras')
            .delete()
            .eq('id', req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Erro ao excluir config financeira:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROTA DE RELATÓRIOS ====================

app.get('/api/relatorios', authenticate, async (req, res) => {
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        const { inicio, fim } = req.query;

        const { count: totalAlunos } = await supabase
            .from('alunos')
            .select('*', { count: 'exact', head: true })
            .eq('escola_id', perfil.escola_id)
            .eq('ativo', true);

        const primeiroDiaMes = new Date();
        primeiroDiaMes.setDate(1);
        primeiroDiaMes.setHours(0, 0, 0, 0);

        const { count: alunosNovosMes } = await supabase
            .from('alunos')
            .select('*', { count: 'exact', head: true })
            .eq('escola_id', perfil.escola_id)
            .eq('ativo', true)
            .gte('created_at', primeiroDiaMes.toISOString());

        const { data: todasTurmas } = await supabase
            .from('turmas')
            .select('*')
            .eq('escola_id', perfil.escola_id)
            .eq('ativa', true);

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

                if (d >= inicioSemana && d <= fimSemana) {
                    aulasSemana += aulasHoje.length;
                }
            }
        }

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
        console.error('❌ Erro em relatorios:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/presencas-aula', authenticate, async (req, res) => {
    const { turma_id, data } = req.query;
    if (!turma_id || !data) {
        return res.json([]);
    }
    
    try {
        const perfil = await getPerfil(req.user.id);
        
        if (!perfil) {
            return res.status(401).json({ error: 'Perfil não encontrado' });
        }

        const aulaId = `${turma_id}_${data}`;
        
        const { data: presencas } = await supabase
            .from('presencas')
            .select('*, alunos(nome, telefone)')
            .eq('aula_id', aulaId)
            .eq('escola_id', perfil.escola_id);
        
        res.json(presencas || []);
    } catch (error) {
        console.error('❌ Erro ao buscar presenças:', error);
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

// ==================== ROTA 404 ====================

app.use((req, res) => {
    console.log('[404] Rota não encontrada:', req.url);
    res.status(404).send('Página não encontrada');
});

// ==================== INICIAR SERVIDOR ====================

app.listen(port, () => {
    console.log('🏐 B&T Tech rodando em http://localhost:' + port);
    console.log('🔗 BASE_URL:', BASE_URL);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promessa rejeitada:', reason);
});
