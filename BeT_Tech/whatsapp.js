// whatsapp.js - Módulo de conexão e envio de mensagens

const { Client, LocalAuth, MessageTypes } = require('wppconnect');
const qrcode = require('qrcode');

let client = null;
let isConnected = false;
let sessionReady = null;

// Inicializa o cliente WPPConnect
async function startWhatsApp() {
    console.log('📱 Inicializando WhatsApp...');
    
    client = new Client({
        authStrategy: new LocalAuth({
            dataPath: 'sessions' // Pasta onde salva a sessão
        }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', async (qr) => {
        // Gera QR Code no terminal
        console.log('📷 Escaneie o QR Code abaixo:');
        qrcode.toTerminal(qr);
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp conectado e pronto!');
        isConnected = true;
        if (sessionReady) sessionReady(true);
    });

    client.on('disconnected', () => {
        console.log('❌ WhatsApp desconectado');
        isConnected = false;
    });

    client.on('message', async (message) => {
        // Aqui você trata as respostas dos alunos
        await handleIncomingMessage(message);
    });

    await client.initialize();
}

// Função para esperar o WhatsApp estar pronto
function waitForReady() {
    return new Promise((resolve) => {
        if (isConnected) {
            resolve(true);
        } else {
            sessionReady = resolve;
        }
    });
}

// Envia mensagem com botões interativos
async function sendMessageWithButtons(telefone, mensagem, botoes) {
    if (!client || !isConnected) {
        console.log('❌ WhatsApp não conectado');
        return { success: false, error: 'WhatsApp não conectado' };
    }

    try {
        const chatId = `${telefone}@c.us`;
        
        // Envia mensagem com botões
        const buttons = botoes.map(b => ({
            buttonId: b.id,
            buttonText: { displayText: b.title },
            type: 1
        }));

        await client.sendMessage(chatId, {
            text: mensagem,
            buttons: buttons,
            headerType: 1
        });

        console.log(`✅ Mensagem enviada para ${telefone}`);
        return { success: true };
    } catch (error) {
        console.error(`❌ Erro ao enviar para ${telefone}:`, error.message);
        return { success: false, error: error.message };
    }
}

// Envia mensagem simples
async function sendSimpleMessage(telefone, mensagem) {
    if (!client || !isConnected) {
        return { success: false, error: 'WhatsApp não conectado' };
    }

    try {
        const chatId = `${telefone}@c.us`;
        await client.sendMessage(chatId, mensagem);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Trata mensagens recebidas (respostas dos botões)
async function handleIncomingMessage(message) {
    try {
        // Verifica se é uma resposta de botão
        if (message.type === 'buttons_response') {
            const buttonId = message.buttonResponseId;
            const resposta = message.buttonResponseText;
            const numero = message.from.split('@')[0];
            
            console.log(`📩 Resposta recebida de ${numero}: ${resposta} (ID: ${buttonId})`);
            
            // Dispara evento para o scheduler/API tratar
            // Você pode criar um webhook ou salvar no banco aqui
            if (process.env.ON_MESSAGE_CALLBACK) {
                fetch(process.env.ON_MESSAGE_CALLBACK, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        numero,
                        resposta,
                        buttonId,
                        mensagem: message.body
                    })
                });
            }
        }
    } catch (error) {
        console.error('Erro ao tratar mensagem:', error);
    }
}

// Obtém o status da conexão
function getStatus() {
    return {
        connected: isConnected,
        client: client ? 'initialized' : 'not_initialized'
    };
}

module.exports = {
    startWhatsApp,
    sendMessageWithButtons,
    sendSimpleMessage,
    waitForReady,
    getStatus
};
