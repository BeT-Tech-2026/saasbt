// ============================================
// CONFIGURAÇÃO DO SUPABASE - CLIENTE PÚBLICO
// ============================================
// ⚠️ ATENÇÃO: Este arquivo contém apenas chaves PÚBLICAS
// ⚠️ Para operações autenticadas, usar /api/* do servidor
// ============================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

// Chave pública (safe para expor no frontend)
const SUPABASE_URL = 'https://nedrgsiycizosfyckkof.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lZHJnc2l5Y2l6b3NmeWNra29mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzOTk4MTcsImV4cCI6MjA5MDk3NTgxN30.rU20xzsHwYLyQDv1z9aVJhu_NawxBiDSlmSm2mRE2cM';

// Cria o cliente global (apenas para operações públicas)
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// FUNÇÕES AUXILIARES PÚBLICAS
// ============================================

// Busca a sessão atual do localStorage
export function getSession() {
    const token = localStorage.getItem('token');
    return token ? { access_token: token } : null;
}

// Busca perfil do localStorage (não faz chamada API)
export function getPerfilLocal() {
    const perfilStr = localStorage.getItem('perfil');
    return perfilStr ? JSON.parse(perfilStr) : null;
}

// Verifica se há token válido
export function isAuthenticated() {
    return !!localStorage.getItem('token');
}

// Faz logout (limpa localStorage)
export function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('perfil');
    window.location.href = '/';
}

// Requisição autenticada para API do servidor
export async function apiAuthenticated(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/';
        throw new Error('Não autenticado');
    }

    const response = await fetch(endpoint, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        }
    });

    if (response.status === 401) {
        logout();
        throw new Error('Sessão expirada');
    }

    return response;
}
