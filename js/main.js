/* =========================================
   Juroc Solutions — Main JavaScript
   ========================================= */

document.addEventListener('DOMContentLoaded', () => {

  /* --- Header scroll effect --- */
  const header = document.querySelector('.site-header');
  if (header) {
    window.addEventListener('scroll', () => {
      header.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }

  /* --- Mobile navigation --- */
  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');
  if (hamburger && navMenu) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', hamburger.classList.contains('open'));
    });
    /* Close menu when a link is clicked */
    navMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navMenu.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* --- Active nav link --- */
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-menu a').forEach(link => {
    const linkPath = link.getAttribute('href').split('/').pop();
    if (linkPath === currentPath || (currentPath === '' && linkPath === 'index.html')) {
      link.classList.add('active');
    }
  });

  /* --- Smooth scroll for anchor links --- */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const id = anchor.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        const offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height')) || 72;
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* --- Scroll-reveal animations --- */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.classList.add('revealed'), index * 80);
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('[data-reveal]').forEach(el => revealObserver.observe(el));

  /* --- Contact form handling --- */
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('[type="submit"]');
      const successMsg = form.querySelector('.form-message.success');
      const errorMsg = form.querySelector('.form-message.error-msg');
      if (successMsg) successMsg.style.display = 'none';
      if (errorMsg) errorMsg.style.display = 'none';

      /* Basic validation */
      let valid = true;
      form.querySelectorAll('[required]').forEach(input => {
        input.classList.remove('error');
        if (!input.value.trim()) {
          input.classList.add('error');
          valid = false;
        }
      });
      const emailInput = form.querySelector('[type="email"]');
      if (emailInput && emailInput.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value)) {
        emailInput.classList.add('error');
        valid = false;
      }
      const consentCheck = form.querySelector('#consent');
      if (consentCheck && !consentCheck.checked) {
        valid = false;
        if (errorMsg) {
          errorMsg.textContent = 'Please accept the privacy policy to continue.';
          errorMsg.style.display = 'block';
        }
      }
      if (!valid) return;

      /* Simulate form submission */
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      await new Promise(r => setTimeout(r, 1200));
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Message';
      form.reset();
      if (successMsg) successMsg.style.display = 'block';
    });

    /* Remove error state on input */
    form.querySelectorAll('.form-control').forEach(input => {
      input.addEventListener('input', () => input.classList.remove('error'));
    });
  }

  /* --- Cookie consent banner --- */
  const banner = document.getElementById('cookieBanner');
  if (banner) {
    const COOKIE_KEY = 'juroc_cookie_consent';
    if (!localStorage.getItem(COOKIE_KEY)) {
      setTimeout(() => banner.classList.add('visible'), 1000);
    }
    document.getElementById('cookieAccept')?.addEventListener('click', () => {
      localStorage.setItem(COOKIE_KEY, 'accepted');
      banner.classList.remove('visible');
    });
    document.getElementById('cookieDecline')?.addEventListener('click', () => {
      localStorage.setItem(COOKIE_KEY, 'declined');
      banner.classList.remove('visible');
    });
  }

  /* --- Year update in footer --- */
  document.querySelectorAll('.current-year').forEach(el => {
    el.textContent = new Date().getFullYear();
  });
});
