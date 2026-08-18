(function () {
    const ENDPOINT = 'https://rggpyiterdbbugluejcs.supabase.co/functions/v1/sautilink-contact';
    const form = document.getElementById('contact-form');
    if (!form) return;

    const submitButton = document.getElementById('contact-submit');
    const formCard = document.getElementById('contact-form-card');
    const successPanel = document.getElementById('contact-success');
    const notice = document.getElementById('contact-notice');
    const resetButton = document.getElementById('contact-again');

    function setNotice(message, state) {
        notice.textContent = message || '';
        notice.dataset.state = state || '';
        notice.hidden = !message;
    }

    function setBusy(busy) {
        submitButton.disabled = busy;
        submitButton.querySelector('span').textContent = busy ? 'Sending securely…' : 'Send message';
    }

    async function send(payload) {
        const controller = new AbortController();
        const timeout = window.setTimeout(function () { controller.abort(); }, 12000);
        try {
            const response = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            const result = await response.json().catch(function () { return null; });
            if (!response.ok || !result || !result.ok) {
                const message = result && result.error && result.error.message
                    ? result.error.message
                    : 'We could not send your message. Please try again.';
                throw new Error(message);
            }
            return result;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    form.addEventListener('submit', async function (event) {
        event.preventDefault();
        setNotice('', '');

        if (!form.reportValidity()) return;

        const data = new FormData(form);
        const payload = {
            name: String(data.get('name') || ''),
            email: String(data.get('email') || ''),
            topic: String(data.get('topic') || ''),
            subject: String(data.get('subject') || ''),
            message: String(data.get('message') || ''),
            website: String(data.get('website') || '')
        };

        setBusy(true);
        try {
            await send(payload);
            form.reset();
            formCard.hidden = true;
            successPanel.hidden = false;
            successPanel.focus();
        } catch (error) {
            const message = error && error.name === 'AbortError'
                ? 'The request took too long. Check your connection and try again.'
                : error.message;
            setNotice(message, 'error');
        } finally {
            setBusy(false);
        }
    });

    if (resetButton) {
        resetButton.addEventListener('click', function () {
            successPanel.hidden = true;
            formCard.hidden = false;
            setNotice('', '');
            document.getElementById('contact-name').focus();
        });
    }
})();
