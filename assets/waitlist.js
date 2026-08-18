(function () {
    'use strict';

    const API_URL = 'https://rggpyiterdbbugluejcs.supabase.co/functions/v1/sautilink-waitlist';
    const PENDING_KEY = 'sautilink_waitlist_pending';
    const PENDING_MAX_AGE_MS = 15 * 60 * 1000;
    const DEFAULT_OTP_LENGTH = 8;
    const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{2,29}$/;
    const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    const form = document.getElementById('waitlist-form');
    if (!form) return;

    const detailsPanel = document.getElementById('details-panel');
    const verificationPanel = document.getElementById('verification-panel');
    const successPanel = document.getElementById('success-panel');
    const usernameInput = document.getElementById('username');
    const emailInput = document.getElementById('email');
    const websiteInput = document.getElementById('website');
    const usernameState = document.getElementById('username-state');
    const formMessage = document.getElementById('form-message');
    const submitButton = document.getElementById('submit-btn');
    const verificationForm = document.getElementById('verification-form');
    const verificationMessage = document.getElementById('verification-message');
    const verificationEmail = document.getElementById('verification-email');
    const verifyButton = document.getElementById('verify-btn');
    const resendButton = document.getElementById('resend-code');
    const changeDetailsButton = document.getElementById('change-details');
    const otpGrid = document.getElementById('otp-grid');
    const languageSelector = document.querySelector('[data-language-selector]');

    let pending = null;
    let usernameTimer = null;
    let usernameRequestId = 0;
    let availableUsername = '';
    let resendTimer = null;

    function normalizeUsername(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/^@+/, '')
            .replace(/[^a-z0-9._]/g, '')
            .slice(0, 30);
    }

    function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
    }

    function validUsername(value) {
        return USERNAME_PATTERN.test(normalizeUsername(value));
    }

    function validEmail(value) {
        return EMAIL_PATTERN.test(normalizeEmail(value));
    }

    function setMessage(node, message, type) {
        if (!node) return;
        node.textContent = message || '';
        node.className = `form-message${type ? ` ${type}` : ''}`;
        node.hidden = !message;
    }

    function setButtonLoading(button, loading, loadingText) {
        if (!button) return;
        if (!button.dataset.defaultText) {
            button.dataset.defaultText = button.querySelector('span')?.textContent || button.textContent.trim();
        }
        const label = button.querySelector('span');
        if (label) label.textContent = loading ? loadingText : button.dataset.defaultText;
        button.disabled = loading;
        button.setAttribute('aria-busy', String(loading));
    }

    async function api(action, values) {
        const controller = new AbortController();
        const timer = window.setTimeout(function () { controller.abort(); }, 12000);
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ action, ...values }),
                signal: controller.signal,
            });
            let payload = null;
            try { payload = await response.json(); } catch { payload = null; }
            if (!response.ok || payload?.ok === false) {
                const error = new Error(payload?.error?.message || 'We could not complete that request. Please try again.');
                error.code = payload?.error?.code || `HTTP_${response.status}`;
                error.status = response.status;
                throw error;
            }
            return payload?.data || {};
        } catch (error) {
            if (error?.name === 'AbortError') {
                const timeoutError = new Error('The request took too long. Check your connection and try again.');
                timeoutError.code = 'TIMEOUT';
                throw timeoutError;
            }
            throw error;
        } finally {
            window.clearTimeout(timer);
        }
    }

    function setUsernameState(message, type) {
        if (!usernameState) return;
        usernameState.textContent = message;
        usernameState.className = `field-state${type ? ` ${type}` : ''}`;
    }

    async function checkUsername(value, options) {
        const username = normalizeUsername(value);
        const requestId = ++usernameRequestId;
        availableUsername = '';

        if (!username) {
            setUsernameState('Type a username to check availability.');
            return false;
        }
        if (!validUsername(username)) {
            setUsernameState('Use 3–30 lowercase letters, numbers, dots or underscores.', 'bad');
            return false;
        }

        setUsernameState('Checking availability…', 'checking');
        try {
            const data = await api('check_username', { username });
            if (requestId !== usernameRequestId) return false;
            if (data.available === true) {
                availableUsername = username;
                setUsernameState(`@${username} is available.`, 'good');
                return true;
            }
            setUsernameState(`@${username} is already taken. Choose another username.`, 'bad');
            return false;
        } catch (error) {
            if (requestId !== usernameRequestId) return false;
            setUsernameState(error?.message || 'Unable to check this username right now.', 'bad');
            if (options?.showFormError) setMessage(formMessage, error?.message, 'error');
            return false;
        }
    }

    function setProgress(stage) {
        const order = ['details', 'verify', 'ready'];
        const current = order.indexOf(stage);
        document.querySelectorAll('[data-progress-step]').forEach(function (node) {
            const index = order.indexOf(node.dataset.progressStep);
            node.classList.toggle('active', index === current);
            node.classList.toggle('done', index < current);
        });
    }

    function showPanel(stage) {
        detailsPanel.hidden = stage !== 'details';
        verificationPanel.hidden = stage !== 'verify';
        successPanel.hidden = stage !== 'ready';
        setProgress(stage);
    }

    function otpInputs() {
        return Array.from(otpGrid?.querySelectorAll('input') || []);
    }

    function otpValue() {
        return otpInputs().map(function (input) { return input.value; }).join('');
    }

    function fillOtp(value) {
        const digits = String(value || '').replace(/\D/g, '');
        const inputs = otpInputs();
        inputs.forEach(function (input, index) { input.value = digits[index] || ''; });
        const next = inputs[Math.min(digits.length, inputs.length - 1)];
        if (next) next.focus();
    }

    function buildOtp(length) {
        const safeLength = Number.isInteger(length) && length >= 6 && length <= 10 ? length : DEFAULT_OTP_LENGTH;
        otpGrid.innerHTML = '';
        otpGrid.style.gridTemplateColumns = `repeat(${safeLength}, minmax(0, 1fr))`;
        otpGrid.dataset.length = String(safeLength);

        for (let index = 0; index < safeLength; index += 1) {
            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'numeric';
            input.autocomplete = index === 0 ? 'one-time-code' : 'off';
            input.maxLength = 1;
            input.pattern = '[0-9]';
            input.setAttribute('aria-label', `Verification code digit ${index + 1} of ${safeLength}`);
            input.addEventListener('input', function () {
                input.value = input.value.replace(/\D/g, '').slice(-1);
                if (input.value && index < safeLength - 1) otpInputs()[index + 1].focus();
            });
            input.addEventListener('keydown', function (event) {
                if (event.key === 'Backspace' && !input.value && index > 0) otpInputs()[index - 1].focus();
                if (event.key === 'ArrowLeft' && index > 0) otpInputs()[index - 1].focus();
                if (event.key === 'ArrowRight' && index < safeLength - 1) otpInputs()[index + 1].focus();
            });
            input.addEventListener('paste', function (event) {
                event.preventDefault();
                fillOtp(event.clipboardData?.getData('text') || '');
            });
            otpGrid.appendChild(input);
        }
    }

    function savePending(value) {
        pending = value;
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    }

    function clearPending() {
        pending = null;
        sessionStorage.removeItem(PENDING_KEY);
    }

    function readPending() {
        try {
            const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
            if (!value?.email || !value?.username || Date.now() - Number(value.createdAt || 0) > PENDING_MAX_AGE_MS) {
                clearPending();
                return null;
            }
            return value;
        } catch {
            clearPending();
            return null;
        }
    }

    function showVerification(value) {
        pending = value;
        verificationEmail.textContent = value.email;
        buildOtp(value.otpLength || DEFAULT_OTP_LENGTH);
        setMessage(verificationMessage, '', '');
        showPanel('verify');
        window.setTimeout(function () { otpInputs()[0]?.focus(); }, 50);
    }

    function startResendCooldown(seconds) {
        window.clearInterval(resendTimer);
        let remaining = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 60;
        resendButton.disabled = remaining > 0;
        resendButton.textContent = remaining > 0 ? `Resend in ${remaining}s` : 'Resend code';
        if (!remaining) return;
        resendTimer = window.setInterval(function () {
            remaining -= 1;
            resendButton.disabled = remaining > 0;
            resendButton.textContent = remaining > 0 ? `Resend in ${remaining}s` : 'Resend code';
            if (remaining <= 0) window.clearInterval(resendTimer);
        }, 1000);
    }

    usernameInput.addEventListener('input', function () {
        const normalized = normalizeUsername(usernameInput.value);
        if (usernameInput.value !== normalized) usernameInput.value = normalized;
        window.clearTimeout(usernameTimer);
        usernameTimer = window.setTimeout(function () { checkUsername(normalized); }, 420);
    });

    usernameInput.addEventListener('blur', function () {
        window.clearTimeout(usernameTimer);
        checkUsername(usernameInput.value);
    });

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        setMessage(formMessage, '', '');

        const username = normalizeUsername(usernameInput.value);
        const email = normalizeEmail(emailInput.value);
        usernameInput.value = username;
        emailInput.value = email;

        if (websiteInput?.value) return;
        if (!validUsername(username)) {
            setUsernameState('Choose a valid SautiLink username.', 'bad');
            usernameInput.focus();
            return;
        }
        if (!validEmail(email)) {
            setMessage(formMessage, 'Enter a valid email address.', 'error');
            emailInput.focus();
            return;
        }

        setButtonLoading(submitButton, true, 'Checking and sending code…');
        try {
            if (availableUsername !== username) {
                const available = await checkUsername(username, { showFormError: true });
                if (!available) return;
            }
            const data = await api('start', { username, email, website: websiteInput?.value || '' });
            const next = { username, email, otpLength: data.otpLength || DEFAULT_OTP_LENGTH, createdAt: Date.now() };
            savePending(next);
            showVerification(next);
            startResendCooldown(data.resendAfter || 60);
        } catch (error) {
            if (error?.code === 'USERNAME_TAKEN') {
                availableUsername = '';
                setUsernameState(`@${username} is already taken. Choose another username.`, 'bad');
                usernameInput.focus();
            }
            setMessage(formMessage, error?.message || 'Unable to send a verification code right now.', 'error');
        } finally {
            setButtonLoading(submitButton, false, '');
        }
    });

    verificationForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        setMessage(verificationMessage, '', '');
        if (!pending) {
            showPanel('details');
            return;
        }

        const code = otpValue();
        const expectedLength = Number(otpGrid.dataset.length || DEFAULT_OTP_LENGTH);
        if (!new RegExp(`^\\d{${expectedLength}}$`).test(code)) {
            setMessage(verificationMessage, `Enter all ${expectedLength} digits from the verification email.`, 'error');
            otpInputs().find(function (input) { return !input.value; })?.focus();
            return;
        }

        setButtonLoading(verifyButton, true, 'Verifying your email…');
        try {
            const data = await api('verify', { email: pending.email, username: pending.username, code });
            document.getElementById('success-username').textContent = `@${data.username || pending.username}`;
            document.getElementById('success-email').textContent = data.email || pending.email;
            clearPending();
            showPanel('ready');
            successPanel.focus?.();
        } catch (error) {
            setMessage(verificationMessage, error?.message || 'That verification code could not be accepted.', 'error');
            if (error?.code === 'USERNAME_TAKEN') {
                window.setTimeout(function () {
                    showPanel('details');
                    setUsernameState(`@${pending.username} was just claimed. Choose another username.`, 'bad');
                    availableUsername = '';
                    usernameInput.focus();
                }, 1400);
            } else {
                fillOtp('');
            }
        } finally {
            setButtonLoading(verifyButton, false, '');
        }
    });

    resendButton.addEventListener('click', async function () {
        if (!pending || resendButton.disabled) return;
        resendButton.disabled = true;
        setMessage(verificationMessage, '', '');
        try {
            const data = await api('resend', { email: pending.email, username: pending.username });
            setMessage(verificationMessage, 'A new verification code has been sent.', 'success');
            startResendCooldown(data.resendAfter || 60);
        } catch (error) {
            setMessage(verificationMessage, error?.message || 'Unable to resend the code yet.', 'error');
            startResendCooldown(15);
        }
    });

    changeDetailsButton.addEventListener('click', function () {
        window.clearInterval(resendTimer);
        clearPending();
        showPanel('details');
        setMessage(verificationMessage, '', '');
        usernameInput.focus();
    });

    if (languageSelector) {
        languageSelector.addEventListener('change', function () {
            window.location.href = languageSelector.value;
        });
    }

    const restored = readPending();
    if (restored) {
        usernameInput.value = restored.username;
        emailInput.value = restored.email;
        showVerification(restored);
        startResendCooldown(Math.max(0, 60 - Math.floor((Date.now() - Number(restored.createdAt || 0)) / 1000)));
    } else {
        showPanel('details');
    }
}());
