export const BIRTH_DATE_MIN_YEAR = 1900;

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function localDateIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function daysInBirthMonth(year, month) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    return 31;
  }
  return new Date(numericYear, numericMonth, 0).getDate();
}

export function splitBirthDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return { year: '', month: '', day: '' };
  return { year: match[1], month: match[2], day: match[3] };
}

export function normalizeBirthDateParts({ year, month, day } = {}, { today = new Date() } = {}) {
  const yearValue = Number(year);
  const monthValue = Number(month);
  const dayValue = Number(day);
  const todayIso = localDateIso(today);

  if (!year || !month || !day) {
    return { value: '', error: 'Choose your complete date of birth.' };
  }
  if (!Number.isInteger(yearValue) || yearValue < BIRTH_DATE_MIN_YEAR) {
    return { value: '', error: 'Choose a valid year of birth.' };
  }
  if (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) {
    return { value: '', error: 'Choose a valid month of birth.' };
  }

  const maxDay = daysInBirthMonth(yearValue, monthValue);
  if (!Number.isInteger(dayValue) || dayValue < 1 || dayValue > maxDay) {
    return { value: '', error: 'Choose a valid day of birth.' };
  }

  const value = `${yearValue}-${pad2(monthValue)}-${pad2(dayValue)}`;
  if (todayIso && value > todayIso) {
    return { value: '', error: 'Date of birth cannot be in the future.' };
  }

  return { value, error: '' };
}
