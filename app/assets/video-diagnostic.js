const result = document.getElementById('result');
const id = new URLSearchParams(location.search).get('id') || '';
if (!/^[0-9a-f-]{36}$/i.test(id)) {
  result.textContent = 'Invalid media ID.';
} else {
  try {
    const response = await fetch(`/api/sauti-media/${encodeURIComponent(id)}?quality=360&diagnose=1`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    result.textContent = JSON.stringify({ status: response.status, body: await response.json() }, null, 2);
  } catch (error) {
    result.textContent = String(error?.message || error);
  }
}
