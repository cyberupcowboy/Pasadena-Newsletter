import { supabase } from '../lib/current.js';

const form = document.querySelector('#alertPreferencesForm');
const email = document.querySelector('#alertsEmail');
const cadence = document.querySelector('#alertsCadence');
const consent = document.querySelector('#alertsConsent');
const topicOptions = document.querySelector('#topicOptions');
const neighborhoodOptions = document.querySelector('#neighborhoodOptions');
const message = document.querySelector('#alertsMessage');

const TOPICS = [
  ['local','Pasadena / local news'],['schools','AACPS / schools'],['public_safety','Police & fire'],['weather','Severe weather'],
  ['traffic','Traffic & road closures'],['missing_persons','Missing persons'],['government','Government / zoning'],['events','Community events'],
  ['water','Bay / boating / water'],['business','Local business'],
];

function makeCheck(container, value, label, checked = false) {
  const wrapper = document.createElement('label');
  const input = document.createElement('input'); input.type = 'checkbox'; input.value = value; input.checked = checked;
  const text = document.createElement('span'); text.textContent = label;
  wrapper.append(input,text); container.append(wrapper);
}

function selected(container) {
  return [...container.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

async function load() {
  TOPICS.forEach(([value,label],index) => makeCheck(topicOptions,value,label,index < 5));
  const { data } = await supabase.from('neighborhoods').select('slug,name').order('sort_order');
  (data || []).forEach((row) => makeCheck(neighborhoodOptions,row.slug,row.name,row.slug === 'pasadena'));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = 'Saving your preferences…'; message.dataset.kind = 'info';
  const payload = {
    email: email.value.trim(), categories: selected(topicOptions), neighborhoods: selected(neighborhoodOptions),
    cadence: cadence.value, consent: consent.checked, source: 'preferences_page',
  };
  const { error } = await supabase.from('alert_subscriptions').insert(payload);
  if (error?.code === '23505') {
    message.textContent = 'That email already has a subscription request for this cadence. The editor can update it when delivery is activated.';
    message.dataset.kind = 'success'; return;
  }
  if (error) { message.textContent = `Could not save preferences: ${error.message}`; message.dataset.kind = 'error'; return; }
  message.textContent = 'Preferences saved. They will be activated when the selected email delivery workflow is enabled.';
  message.dataset.kind = 'success'; form.reset();
});

load();
