function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function sanitizeSingleLine(value) {
  return String(value ?? '')
    .replace(/[<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeFreeText(value) {
  return String(value ?? '')
    .replace(/[<>`]/g, '')
    .replace(/\r/g, '')
    .trim();
}

function isPositiveInt(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
}

function extractPhoneLocalDigits(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return digits.slice(1);
  }

  if (digits.length === 10) {
    return digits;
  }

  return null;
}

export function formatPhoneForStorage(phone) {
  if (isBlank(phone)) return null;

  const localDigits = extractPhoneLocalDigits(phone);
  assert(localDigits && localDigits.length === 10, 'Телефон должен содержать 10 цифр номера и отображаться в формате +7-999-123-45-67.');

  return `+7-${localDigits.slice(0, 3)}-${localDigits.slice(3, 6)}-${localDigits.slice(6, 8)}-${localDigits.slice(8, 10)}`;
}

export function validateLogin(login) {
  assert(!isBlank(login), 'Логин обязателен.');
  assert(/^[A-Za-z0-9_][A-Za-z0-9_.-]{2,49}$/.test(login), 'Логин должен содержать 3–50 символов: латиница, цифры, _, ., -');
}

export function validatePassword(password) {
  assert(typeof password === 'string' && password.length >= 6, 'Пароль должен содержать минимум 6 символов.');
}

export function validateFullName(fullName) {
  assert(!isBlank(fullName), 'ФИО обязательно.');
  const value = sanitizeSingleLine(fullName);
  assert(/^[A-Za-zА-Яа-яЁё\s.'-]{3,120}$/.test(value), 'ФИО должно содержать только буквы, пробелы, дефис, точку или апостроф.');
}

export function validatePhone(phone) {
  if (isBlank(phone)) return;
  const formattedPhone = formatPhoneForStorage(phone);
  assert(/^\+7-\d{3}-\d{3}-\d{2}-\d{2}$/.test(formattedPhone), 'Телефон имеет неверный формат.');
}

export function validateEmail(email) {
  if (isBlank(email)) return;
  assert(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(email)), 'Email имеет неверный формат.');
}

export function validateSupplierName(name) {
  const value = sanitizeSingleLine(name);
  assert(!isBlank(value), 'Наименование поставщика обязательно.');
  assert(/^[A-Za-zА-Яа-яЁё0-9\s"'().,№#&/-]{2,200}$/.test(value), 'Наименование поставщика заполнено некорректно.');
}

export function validateClientPayload(data) {
  assert(['PERSON', 'COMPANY'].includes(data.client_type), 'Неверный тип клиента.');

  const name = sanitizeSingleLine(data.name);
  assert(!isBlank(name), 'Наименование/ФИО клиента обязательно.');

  if (data.client_type === 'PERSON') {
    assert(/^[A-Za-zА-Яа-яЁё\s.'-]{3,200}$/.test(name), 'Для физического лица допустим ввод только ФИО.');
  } else {
    assert(/^[A-Za-zА-Яа-яЁё0-9\s"'().,№#&/-]{2,200}$/.test(name), 'Для организации допустим ввод только корректного наименования.');
  }

  validatePhone(data.phone);
  validateEmail(data.email);

  if (!isBlank(data.address)) {
    const address = sanitizeSingleLine(data.address);
    assert(address.length >= 5 && address.length <= 300, 'Адрес должен содержать от 5 до 300 символов.');
    assert(/^[A-Za-zА-Яа-яЁё0-9\s"'().,№#&/-]+$/.test(address), 'Адрес содержит недопустимые символы.');
  }

  if (!isBlank(data.comment)) {
    const comment = sanitizeFreeText(data.comment);
    assert(comment.length <= 2000, 'Комментарий слишком длинный.');
  }
}

export function validateVehiclePayload(data) {
  assert(isPositiveInt(data.client_id), 'Клиент обязателен.');

  const make = sanitizeSingleLine(data.make);
  const model = sanitizeSingleLine(data.model);

  assert(!isBlank(make), 'Марка обязательна.');
  assert(!isBlank(model), 'Модель обязательна.');
  assert(/^[A-Za-zА-Яа-яЁё0-9\s.'()/-]{1,60}$/.test(make), 'Марка заполнена некорректно.');
  assert(/^[A-Za-zА-Яа-яЁё0-9\s.'()/-]{1,60}$/.test(model), 'Модель заполнена некорректно.');

  if (!isBlank(data.vin)) {
    assert(/^[A-HJ-NPR-Z0-9]{17}$/i.test(String(data.vin).trim()), 'VIN должен содержать 17 допустимых символов.');
  }

  if (!isBlank(data.plate_no)) {
    assert(/^[A-Za-zА-Яа-яЁё0-9\s-]{5,15}$/.test(String(data.plate_no).trim()), 'Гос. номер заполнен некорректно.');
  }

  if (data.year !== '' && data.year !== null && data.year !== undefined) {
    const year = Number(data.year);
    assert(Number.isInteger(year) && year >= 1950 && year <= 2100, 'Год выпуска указан неверно.');
  }

  if (data.mileage !== '' && data.mileage !== null && data.mileage !== undefined) {
    const mileage = Number(data.mileage);
    assert(Number.isInteger(mileage) && mileage >= 0, 'Пробег должен быть целым неотрицательным числом.');
  }
}

export function validatePartPayload(data) {
  const partName = sanitizeSingleLine(data.part_name);
  const partCode = sanitizeSingleLine(data.part_code || '');
  const unit = sanitizeSingleLine(data.unit);

  assert(!isBlank(partName), 'Наименование запчасти обязательно.');
  assert(/^[A-Za-zА-Яа-яЁё0-9\s"'().,№#&/+%-]{2,120}$/.test(partName), 'Наименование запчасти заполнено некорректно.');

  if (!isBlank(partCode)) {
    assert(/^[A-Za-z0-9_.\-\/]{2,60}$/.test(partCode), 'Артикул имеет неверный формат.');
  }

  assert(['шт', 'л', 'мл', 'кг', 'г'].includes(unit), 'Единица измерения выбрана некорректно.');

  const stockQty = Number(data.stock_qty ?? 0);
  assert(Number.isInteger(stockQty) && stockQty >= 0, 'Остаток должен быть целым неотрицательным числом.');

  if (data.purchase_price !== '' && data.purchase_price !== null && data.purchase_price !== undefined) {
    const purchasePrice = Number(data.purchase_price);
    assert(Number.isFinite(purchasePrice) && purchasePrice >= 0, 'Закупочная цена указана неверно.');
  }

  if (data.sale_price !== '' && data.sale_price !== null && data.sale_price !== undefined) {
    const salePrice = Number(data.sale_price);
    assert(Number.isFinite(salePrice) && salePrice >= 0, 'Розничная цена указана неверно.');
  }
}

export function validateWorkOrderPayload(data) {
  assert(isPositiveInt(data.client_id), 'Клиент обязателен.');
  assert(isPositiveInt(data.vehicle_id), 'Автомобиль обязателен.');

  if (data.master_id !== '' && data.master_id !== null && data.master_id !== undefined) {
    assert(isPositiveInt(data.master_id), 'Назначенный мастер указан некорректно.');
  }

  const problemDesc = sanitizeFreeText(data.problem_desc);
  assert(!isBlank(problemDesc), 'Описание неисправности обязательно.');
  assert(problemDesc.length >= 5, 'Описание неисправности должно быть информативным.');

  if (!isBlank(data.admin_comment)) {
    const adminComment = sanitizeFreeText(data.admin_comment);
    assert(adminComment.length <= 2000, 'Комментарий администратора слишком длинный.');
  }
}

export function validateAdminClosingComment(value) {
  const comment = sanitizeFreeText(value);
  assert(!isBlank(comment), 'Краткий отчет администратора обязателен.');
  assert(comment.length >= 5, 'Краткий отчет администратора слишком короткий.');
}

export function validatePurchaseOrderPayload(data) {
  assert(isPositiveInt(data.supplier_id), 'Поставщик обязателен.');

  if (!isBlank(data.expected_date)) {
    const expectedDate = new Date(data.expected_date);
    assert(!Number.isNaN(expectedDate.getTime()), 'Ожидаемая дата указана некорректно.');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    expectedDate.setHours(0, 0, 0, 0);
    assert(expectedDate >= today, 'Нельзя указывать ожидаемую дату в прошлом.');
  }

  if (!isBlank(data.comment)) {
    const comment = sanitizeFreeText(data.comment);
    assert(comment.length <= 2000, 'Комментарий слишком длинный.');
  }

  assert(Array.isArray(data.items) && data.items.length > 0, 'Добавьте хотя бы одну позицию заказа.');

  for (const item of data.items) {
    assert(isPositiveInt(item.part_id), 'У позиции заказа не указана запчасть.');
    const qty = Number(item.qty);
    assert(Number.isInteger(qty) && qty > 0, 'Количество в заказе должно быть целым числом больше нуля.');
  }
}