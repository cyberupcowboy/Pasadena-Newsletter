const params = new URLSearchParams(location.search);
const requestedType = params.get('type');
const select = document.querySelector('#submissionType');

if (select && requestedType && [...select.options].some((option) => option.value === requestedType)) {
  select.value = requestedType;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
