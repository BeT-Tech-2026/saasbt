// ============================================
// UTILITÁRIOS DO FRONTEND - B&T Tech
// ============================================

// ========== TEMA LIGHT/DARK ==========
const Theme = {
    STORAGE_KEY: 'bet_theme',
    
    init() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = saved || (prefersDark ? 'dark' : 'light');
        this.set(theme);
    },
    
    set(theme) {
        console.log('Setting theme to:', theme);
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(this.STORAGE_KEY, theme);
        this.updateToggle();
    },
    
    toggle() {
        console.log('Theme toggle called');
        const current = document.documentElement.getAttribute('data-theme');
        console.log('Current theme:', current);
        const newTheme = current === 'dark' ? 'light' : 'dark';
        console.log('New theme:', newTheme);
        this.set(newTheme);
    },
    
    updateToggle() {
        const btn = document.getElementById('themeToggle');
        console.log('Updating toggle button:', btn);
        if (btn) {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            console.log('Is dark:', isDark);
            btn.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
            btn.setAttribute('aria-label', isDark ? 'Alternar para tema claro' : 'Alternar para tema escuro');
        }
    }
};

// ========== TOAST NOTIFICATIONS ==========
const Toast = {
    container: null,
    
    init() {
        this.container = document.getElementById('toastContainer');
    },
    
    show(message, type = 'info', duration = 4000) {
        if (!this.container) this.init();
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'alert');
        
        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        
        toast.innerHTML = `
            <i class="fas ${icons[type] || icons.info}"></i>
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" class="toast-close" aria-label="Fechar">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        this.container.appendChild(toast);
        
        // Auto remove
        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },
    
    success(message) { this.show(message, 'success'); },
    error(message) { this.show(message, 'error'); },
    warning(message) { this.show(message, 'warning'); },
    info(message) { this.show(message, 'info'); }
};

// ========== MODAL ==========
const Modal = {
    show(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('animate-scaleIn');
            document.body.style.overflow = 'hidden';
        }
    },
    
    hide(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    },
    
    toggle(id) {
        const modal = document.getElementById(id);
        if (modal) {
            if (modal.classList.contains('hidden')) {
                this.show(id);
            } else {
                this.hide(id);
            }
        }
    }
};

// ========== SKELETON LOADING ==========
const Skeleton = {
    show(container) {
        const el = typeof container === 'string' ? document.getElementById(container) : container;
        if (el) el.style.display = 'block';
    },
    
    hide(container) {
        const el = typeof container === 'string' ? document.getElementById(container) : container;
        if (el) el.style.display = 'none';
    },
    
    // Gera HTML de skeleton para listas
    list(rows = 3) {
        let html = '';
        for (let i = 0; i < rows; i++) {
            html += `
                <div class="skeleton-card mb-2">
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text" style="width: 60%"></div>
                </div>
            `;
        }
        return html;
    },
    
    // Gera HTML de skeleton para cards
    cards(rows = 4) {
        let html = '';
        for (let i = 0; i < rows; i++) {
            html += `
                <div class="skeleton-card">
                    <div class="skeleton skeleton-title"></div>
                    <div class="skeleton skeleton-text"></div>
                    <div style="display: flex; gap: 8px; margin-top: 12px;">
                        <div class="skeleton" style="width: 80px; height: 32px;"></div>
                        <div class="skeleton" style="width: 80px; height: 32px;"></div>
                    </div>
                </div>
            `;
        }
        return html;
    }
};

// ========== EMPTY STATE ==========
const EmptyState = {
    // Para listas/tabelas vazias
    list(containerId, message, actionText, actionFn) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const actionBtn = actionText && actionFn 
            ? `<button class="btn btn-primary" onclick="${actionFn}">${actionText}</button>` 
            : '';
        
        container.innerHTML = `
            <tr>
                <td colspan="100%">
                    <div class="empty-state-inline" style="display: block;">
                        <i class="fas fa-inbox"></i>
                        <h3>Nenhum registro encontrado</h3>
                        <p>${message}</p>
                        ${actionBtn}
                    </div>
                </td>
            </tr>
        `;
    },
    
    // Para páginas/cards vazios
    show(containerId, icon, title, message, actionText, actionFn) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const actionBtn = actionText && actionFn 
            ? `<button class="btn btn-primary" onclick="${actionFn}">${actionText}</button>` 
            : '';
        
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-${icon || 'inbox'}"></i>
                <h3>${title || 'Nenhum registro encontrado'}</h3>
                <p>${message || 'Comece adicionando novos registros.'}</p>
                ${actionBtn}
            </div>
        `;
    }
};

// ========== LAZY LOADING ==========
const LazyLoad = {
    scripts: {},
    
    loadScript(src, callback) {
        if (this.scripts[src] === 'loaded') {
            if (callback) callback();
            return;
        }
        
        if (this.scripts[src]) {
            // Já carregando
            return;
        }
        
        this.scripts[src] = 'loading';
        
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        
        script.onload = () => {
            this.scripts[src] = 'loaded';
            if (callback) callback();
        };
        
        script.onerror = () => {
            console.error(`Erro ao carregar script: ${src}`);
            this.scripts[src] = 'error';
        };
        
        document.head.appendChild(script);
    },
    
    // Carrega Chart.js apenas quando necessário
    loadChartJs(callback) {
        if (typeof Chart !== 'undefined') {
            if (callback) callback();
            return;
        }
        this.loadScript('https://cdn.jsdelivr.net/npm/chart.js', callback);
    },
    
    // Carrega jsPDF apenas quando necessário
    loadJsPDF(callback) {
        if (typeof jspdf !== 'undefined') {
            if (callback) callback();
            return;
        }
        this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => {
            this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js', callback);
        });
    }
};

// ========== CACHE DE API ==========
const ApiCache = {
    cache: {},
    timers: {},
    DEFAULT_TTL: 5 * 60 * 1000, // 5 minutos
    
    get(key) {
        const item = this.cache[key];
        if (!item) return null;
        
        if (Date.now() > item.expires) {
            delete this.cache[key];
            return null;
        }
        
        return item.data;
    },
    
    set(key, data, ttl = this.DEFAULT_TTL) {
        this.cache[key] = {
            data,
            expires: Date.now() + ttl
        };
    },
    
    invalidate(key) {
        delete this.cache[key];
    },
    
    invalidateAll() {
        this.cache = {};
    },
    
    // Fetch com cache
    async fetch(url, options = {}, ttl = this.DEFAULT_TTL) {
        const cacheKey = url + JSON.stringify(options);
        const cached = this.get(cacheKey);
        
        if (cached) {
            return cached;
        }
        
        const response = await fetch(url, options);
        const data = await response.json();
        this.set(cacheKey, data, ttl);
        
        return data;
    }
};

// ========== INICIALIZAÇÃO ==========
document.addEventListener('DOMContentLoaded', () => {
    Theme.init();
    Toast.init();
});

// Exporta para uso global
window.Theme = Theme;
window.Toast = Toast;
window.Modal = Modal;
window.Skeleton = Skeleton;
window.EmptyState = EmptyState;
window.LazyLoad = LazyLoad;
window.ApiCache = ApiCache;


// ============================================================
// PATCH FINAL RESPONSIVO - SIDEBAR/HAMBURGER
// Mantém o menu mobile consistente em todas as páginas internas.
// ============================================================
(function () {
    function getLayoutElements() {
        return {
            sidebar: document.querySelector('.sidebar'),
            overlay: document.querySelector('.sidebar-overlay'),
            toggle: document.querySelector('.menu-toggle')
        };
    }

    function setSidebarState(open) {
        const { sidebar, overlay, toggle } = getLayoutElements();
        if (!sidebar) return;

        sidebar.classList.toggle('show', open);
        if (overlay) overlay.classList.toggle('show', open);
        document.body.classList.toggle('menu-open', open);
        document.body.classList.toggle('sidebar-open', open);

        if (toggle) {
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? 'Fechar menu de navegação' : 'Abrir menu de navegação');
            const icon = toggle.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-bars', !open);
                icon.classList.toggle('fa-times', open);
            }
        }
    }

    window.toggleSidebar = function (forceClose) {
        const { sidebar } = getLayoutElements();
        if (!sidebar) return;
        const open = forceClose === true ? false : !sidebar.classList.contains('show');
        setSidebarState(open);
    };

    document.addEventListener('DOMContentLoaded', function () {
        const { overlay, toggle } = getLayoutElements();

        if (toggle) {
            toggle.setAttribute('type', 'button');
            toggle.setAttribute('aria-expanded', 'false');
        }

        if (overlay) {
            overlay.addEventListener('click', function () {
                window.toggleSidebar(true);
            });
        }

        document.querySelectorAll('.sidebar .menu-item').forEach(function (link) {
            link.addEventListener('click', function () {
                if (window.innerWidth <= 1024) window.toggleSidebar(true);
            });
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') window.toggleSidebar(true);
        });

        window.addEventListener('resize', function () {
            if (window.innerWidth > 1024) window.toggleSidebar(true);
        });
    });
})();
