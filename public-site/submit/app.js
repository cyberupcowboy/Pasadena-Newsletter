const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';

const form = document.querySelector('#submissionForm');
const submissionType = document.querySelector('#submissionType');
const bylinePreference = document.querySelector('#bylinePreference');
const submitterName = document.querySelector('#submitterName');
const submitterEmail = document.querySelector('#submitterEmail');
const title = document.querySelector('#title');
const description = document.querySelector('#description');
const locationInput = document.querySelector('#location');
const sourceUrl = document.querySelector('#sourceUrl');
const eventFields = document.querySelector('#eventFields');
const startsAt = document.querySelector('#startsAt');
const endsAt = document.querySelector('#endsAt');
const company = document.querySelector('#company');
const consent = document.querySelector('#consent');
const submitButton = document.querySelector('#submitButton');
const formMessage = document.querySelector('#formMessage');

function setMessage(message = '', kind = 'info') {
  formMessage.textContent = message;
  formMessage.dataset.kind = kind;
}

function isoFromLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function updateEventFields() {
  eventFields.classList.toggle('hidden', submissionType.value !== 'event');
}

submissionType.addEventListener('change', updateEventFields);
updateEventFields();

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (company.value.trim()) {
    setMessage('Thanks. Your submission has been received.', 'success');
    form.reset();
    updateEventFields();
    return;
  }

  const lastSubmitted = Number(localStorage.getItem('pasadena-current-last-submission') || '0');
  if (Date.now() - lastSubmitted < 30_000) {
    setMessage('Please wait a moment before sending another submission.', 'error');
    return;
  }

  if (!consent.checked) {
    setMessage('Please confirm the publication and editing permission before submitting.', 'error');
    return;
  }

  const payload = {
    submission_type: submissionType.value,
    submitter_name: submitterName.value.trim(),
    submitter_email: submitterEmail.value.trim(),
    title: title.value.trim(),
    description: description.value.trim(),
    address: locationInput.value.trim() || null,
    starts_at: submissionType.value === 'event' ? isoFromLocal(startsAt.value) : null,
    ends_at: submissionType.value === 'event' ? isoFromLocal(endsAt.value) : null,
    source_url: sourceUrl.value.trim() || null,
    byline_preference: bylinePreference.value,
    consent_to_publish: true,
  };

  submitButton.disabled = true;
  setMessage('Sending this to the editor’s desk…');

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/community_submissions`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Submission failed with ${response.status}`);
    }

    localStorage.setItem('pasadena-current-last-submission', String(Date.now()));
    form.reset();
    updateEventFields();
    setMessage('Received. Your original is saved and will go through the copy desk before a human editor reviews it.', 'success');
  } catch (error) {
    console.error(error);
    setMessage('We could not send your submission. Please check the fields and try again.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});
