// scheduler.js - Agendador de envio de mensagens

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const { sendMessageWithButtons, sendSimpleMessage, waitForReady } = require('./whatsapp');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Aguarda o WhatsApp estar pronto
waitForReady().then(() => {
    console.log('✅ WhatsApp pronto para enviar mensagens');
    iniciarScheduler();
});

function iniciarScheduler() {
    console.log('⏰ Scheduler de confirmações iniciado!');
    
    // Roda a cada 30 minutos
    cron.schedule('*/30 * * * *', async () => {
        await verificarAulasProximas();
    });
}

async function verificarAulasProximas() {
    console.log('🔍 Verificando aulas para confirmar...');
    
    const hoje = new Date().toISOString().split('T')[0];
    const amanha = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    
    // Busca escolas com notificações ativas
    const { data: configs } = await supabase
        .from('config_notificacoes')
        .select('*, escolas(*)')
        .eq('ativo', true);
    
    if (!configs || configs.length === 0) {
        console.log('ℹ️ Nenhuma escola com notificações ativas');
        return;
    }
    
    for (const config of configs) {
        await processarEscola(config, hoje, amanha);
    }
}

async function processarEscola(config, hoje, amanha) {
    const escolaId = config.escola_id;
    const horasAntes = config.horas_antes || 24;
    
    // Busca turmas da escola
    const { data: turmas } = await supabase
        .from('turmas')
        .select('*')
        .eq('escola_id', escolaId)
        .eq('ativa', true);
    
    const diasSemana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const hojeDia = diasSemana[new Date().getDay()];
    
    // Determina qual data verificar (hoje ou amanha)
    let dataVerificar = null;
    let turmasVerificar = [];
    
    // Verifica turmas de HOJE
    const turmasHoje = (turmas || []).filter(t => 
        t.dia_semana === hojeDia || t.data_avulsa === hoje
    );
    
    if (turmasHoje.length > 0) {
        // Verifica se falta X horas para o início da aula
        const turmasParaHoje = await filtrarPorHorario(turmasHoje, horasAntes);
        if (turmasParaHoje.length > 0) {
            turmasVerificar = [...turmasVerificar, ...turmasParaHoje];
            if (!dataVerificar) dataVerificar = hoje;
        }
    }
    
    // Verifica turmas de AMANHÃ
    const amanhaDia = diasSemana[(new Date().getDay() + 1) % 7];
    const turmasAmanha = (turmas || []).filter(t => 
        t.dia_semana === amanhaDia || t.data_avulsa === amanha
    );
    
    if (turmasAmanha.length > 0) {
        turmasVerificar = [...turmasVerificar, ...turmasAmanha];
        if (!dataVerificar) dataVerificar = amanha;
    }
    
    console.log(`📚 ${escolaId}: ${turmasVerificar.length} turmas para confirmar`);
    
    // Envia mensagens para cada turma
    for (const turma of turmasVerificar) {
        await enviarConfirmacoesTurma(turma, dataVerificar, config);
    }
}

async function filtrarPorHorario(turmas, horasAntes) {
    const resultado = [];
    const agora = new Date();
    
    for (const turma of turmas) {
        if (!turma.horario_inicio) continue;
        
        const [hora, minuto] = turma.horario_inicio.split(':');
        const horaAula = new Date();
        horaAula.setHours(parseInt(hora), parseInt(minuto), 0, 0);
        
        const diffHoras = (horaAula - agora) / (1000 * 60 * 60);
        
        // Envia se faltarem entre (horasAntes - 1) e (horasAntes + 1) horas
        if (diffHoras >= horasAntes - 1 && diffHoras <= horasAntes + 1) {
            resultado.push(turma);
        }
    }
    
    return resultado;
}

async function enviarConfirmacoesTurma(turma, dataAula, config) {
    const { data: matriculas } = await supabase
        .from('matriculas')
        .select('*, alunos(*)')
        .eq('turma_id', turma.id)
        .eq('ativa', true);
    
    if (!matriculas || matriculas.length === 0) return;
    
    const dataFormatada = new Date(dataAula).toLocaleDateString('pt-BR', {
        weekday: 'long', day: 'numeric', month: 'long'
    });
    
    const horaFormatada = turma.horario_inicio;
    
    // Mensagem personalizada ou padrão
    let mensagem = config.mensagem_personalizada || 
        `Olá {aluno}! 👋\n\nTem aula de *{turma}* no dia *{data}* às *{hora}*.\n\nConfirme sua presença:`;
    
    mensagem = mensagem
        .replace('{aluno}', '')
        .replace('{turma}', turma.nome)
        .replace('{data}', dataFormatada)
        .replace('{hora}', horaFormatada);
    
    const botoes = [
        { title: '✅ Sim', id: `sim_${turma.id}_${dataAula}` },
        { title: '❌ Não', id: `nao_${turma.id}_${dataAula}` }
    ];
    
    for (const mat of matriculas) {
        if (!mat.alunos?.telefone) continue;
        
        const telefone = mat.alunos.telefone.replace(/\D/g, '');
        
        // Verifica se já enviou mensagem hoje
        const aulaId = `${turma.id}_${dataAula}`;
        
        const { data: existente } = await supabase
            .from('mensagens_confirmacao')
            .select('id')
            .eq('aula_id', aulaId)
            .eq('aluno_id', mat.aluno_id)
            .single();
        
        if (existente) continue;
        
        // Personaliza mensagem com nome do aluno
        const msgPersonalizada = mensagem.replace('{aluno}', mat.alunos.nome);
        
        console.log(`📤 Enviando para ${mat.alunos.nome} (${telefone})...`);
        
        const resultado = await sendMessageWithButtons(telefone, msgPersonalizada, botoes);
        
        if (resultado.success) {
            // Salva no banco
            await supabase
                .from('mensagens_confirmacao')
                .upsert({
                    aula_id: aulaId,
                    aluno_id: mat.aluno_id,
                    turma_id: turma.id,
                    escola_id: config.escola_id,
                    enviado_em: new Date().toISOString()
                }, { onConflict: 'aula_id,aluno_id' });
            
            // Também cria registro de presença
            await supabase
                .from('presencas')
                .upsert({
                    aula_id: aulaId,
                    aluno_id: mat.aluno_id,
                    turma_id: turma.id,
                    status: 'pendente'
                }, { onConflict: 'aula_id,aluno_id' });
        }
    }
}

// Exporta para ser usado pelo webhook
module.exports = { verificarAulasProximas };
