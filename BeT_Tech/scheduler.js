// scheduler.js
// Execute este arquivo junto com o servidor principal

const cron = require('node-cron');
const fetch = require('node-fetch');

// Função principal que verifica aulas e envia mensagens
async function verificarAulasProximas() {
    console.log('🔍 Verificando aulas próximas...');
    
    const token = localStorage.getItem('token'); // Se estiver no contexto do servidor, use outro método
    
    // Busca turmas de hoje e amanhã
    const response = await fetch('/api/aulas-proximas', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const aulas = await response.json();
    
    for (const aula of aulas) {
        // Verifica se já foi enviada a mensagem para esta aula
        if (!aula.mensagemEnviada) {
            await enviarMensagemConfirmacao(aula);
        }
    }
}

// Função para enviar mensagem via WhatsApp
async function enviarMensagemConfirmacao(aula) {
    const { alunos, nome, horario_inicio, data_aula } = aula;
    
    // Converte horário para texto amigável
    const horaAula = new Date(`${data_aula}T${horario_inicio}`).toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit'
    });
    
    const dataFormatada = new Date(data_aula).toLocaleDateString('pt-BR', {
        weekday: 'long', day: 'numeric', month: 'long'
    });
    
    const mensagem = `Olá! 👋\n\nTem aula de *${nome}* amanhã (${dataFormatada}) às *${horaAula*}.\n\nConfirme sua presença:`;
    
    for (const aluno of alunos) {
        if (aluno.alunos.telefone) {
            // Envia mensagem com botões
            await enviarWhatsAppComBotoes(
                aluno.alunos.telefone,
                mensagem,
                [
                    { type: 'button', title: '✅ Sim', id: `confirmar_${aluno.matricula_id}` },
                    { type: 'button', title: '❌ Não', id: `negar_${aluno.matricula_id}` }
                ]
            );
            
            // Marca que a mensagem foi enviada
            await marcarMensagemEnviada(aula.id, aluno.aluno_id);
        }
    }
}

// Função genérica para enviar WhatsApp (adapte ao seu provedor)
// Exemplo usando API da Meta ou WPPConnect
async function enviarWhatsAppComBotoes(telefone, mensagem, botoes) {
    // Remove caracteres não numéricos do telefone
    const numero = telefone.replace(/\D/g, '');
    
    // Exemplo com endpoint genérico - substitua pela sua API
    const response = await fetch('/api/whatsapp/enviar', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`
        },
        body: JSON.stringify({
            numero: `55${numero}`,
            mensagem: mensagem,
            botoes: botoes
        })
    });
    
    return response.json();
}

async function marcarMensagemEnviada(aulaId, alunoId) {
    const token = localStorage.getItem('token');
    await fetch('/api/mensagens-confirmacao', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ aulaId, alunoId })
    });
}

// Agendar execução a cada hora
// Ou defina horários específicos, ex: todo dia às 19:00
cron.schedule('0 * * * *', () => {
    verificarAulasProximas();
});

console.log('✅ Agendador de mensagens confirmado ativado!');
