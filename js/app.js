document.addEventListener('DOMContentLoaded', () => {
    // --- SCREEN NAVIGATION ---
    const loginForm = document.getElementById('loginForm');
    const loginScreen = document.getElementById('login-screen');
    const mainScreen = document.getElementById('main-screen');

    // Handle Login
    if(loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Simulate login process with button animation
            const btn = loginForm.querySelector('.btn-primary');
            const originalText = btn.innerText;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang đăng nhập...';
            btn.style.opacity = '0.8';
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.opacity = '1';
                
                // Transition screens
                loginScreen.classList.remove('active');
                setTimeout(() => {
                    mainScreen.classList.add('active');
                }, 100);
            }, 1000);
        });
    }

    // --- PASSWORD TOGGLE ---
    const togglePassword = document.getElementById('togglePassword');
    const password = document.getElementById('password');

    if (togglePassword && password) {
        togglePassword.addEventListener('click', function () {
            // Toggle the type attribute
            const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
            password.setAttribute('type', type);
            // Toggle the icon
            this.classList.toggle('fa-eye');
            this.classList.toggle('fa-eye-slash');
        });
    }

    // --- BOTTOM NAVIGATION ---
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // 1. Update Navigation UI
            navItems.forEach(nav => {
                nav.classList.remove('active');
                const dot = nav.querySelector('.nav-dot');
                if(dot) dot.remove();
            });
            
            item.classList.add('active');
            const dot = document.createElement('div');
            dot.className = 'nav-dot';
            item.appendChild(dot);

            // 2. Switch Tab Content
            const targetTabId = item.getAttribute('data-tab');
            if (targetTabId) {
                tabContents.forEach(tab => {
                    tab.classList.remove('active');
                });
                const targetTab = document.getElementById(targetTabId);
                if (targetTab) {
                    targetTab.classList.add('active');
                }
            }
        });
    });

    // --- INTERACTIVE ELEMENTS ---
    // AR Button
    const arBtn = document.querySelector('.btn-ar');
    if (arBtn) {
        arBtn.addEventListener('click', function() {
            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang quét...';
            setTimeout(() => {
                this.innerHTML = '<i class="fa-solid fa-check"></i> Đã bắt thú';
                this.style.backgroundColor = '#20c997'; // success color
                
                setTimeout(() => {
                    this.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Bắt Thú AR';
                    this.style.backgroundColor = 'var(--purple)';
                    this.style.color = 'var(--white)';
                }, 2000);
            }, 1000);
        });
    }

    // Media Button
    const mediaBtn = document.querySelector('.btn-media');
    if (mediaBtn) {
        mediaBtn.addEventListener('click', function() {
            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rendering...';
            setTimeout(() => {
                this.innerHTML = '<i class="fa-solid fa-check"></i> Đã xuất Video';
                this.style.backgroundColor = '#20c997'; // success color
                
                setTimeout(() => {
                    this.innerHTML = '<i class="fa-solid fa-video"></i> Time-lapse';
                    this.style.backgroundColor = 'var(--blue)';
                }, 2000);
            }, 1500);
        });
    }

    // Daily Task
    const taskCard = document.querySelector('.daily-task');
    if (taskCard) {
        taskCard.addEventListener('click', function() {
            const icon = this.querySelector('.task-icon');
            const reward = this.querySelector('.task-reward');
            
            icon.innerHTML = '<i class="fa-solid fa-check" style="color: var(--primary)"></i>';
            icon.style.backgroundColor = 'var(--primary-light)';
            
            reward.innerHTML = 'Đã nhận ✓';
            reward.style.backgroundColor = 'var(--primary-light)';
            reward.style.borderColor = 'var(--primary)';
            reward.style.color = 'var(--primary)';
            
            this.style.pointerEvents = 'none';
        });
    }
});
