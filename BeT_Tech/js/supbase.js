// ============================================
// CONFIGURAÇÃO DO SUPABASE
// ============================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

// ⚠️ SUBSTITUA PELAS SUAS CHAVES DO SUPABASE
const SUPABASE_URL = 'https://nedrgsiycizosfyckkof.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lZHJnc2l5Y2l6b3NmeWNra29mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5OTgxNywiZXhwIjoyMDkwOTc1ODE3fQ.rU20xzsHwYLyQDv1z9aVJhu_NawxBiDSlmSm2mRE2cM';

// Cria o cliente global
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

// Busca a sessão atual
export async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
}

// Busca o usuário logado
export async function getUser() {
    const { data } = await supabase.auth.getUser();
    return data.user;
}

// Faz logout
export async function signOut() {
    return await supabase.auth.signOut();
}

// Busca o perfil completo do usuário (dono ou professor)
export async function getPerfil(userId) {
    const { data } = await supabase
        .from('perfis')
        .select('*, escolas(nome)')
        .eq('id', userId)
        .single();
    return data;
}

// Verifica se o usuário está autenticado
export async function checkAuth() {
    const session = await getSession();
    if (!session && window.location.pathname !== '/') {
        window.location.href = '/';
        return null;
    }
    return session;
}
