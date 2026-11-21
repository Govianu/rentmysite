const fail = (message, status = 400) => Object.assign(new Error(message), { status, expose: true });
const str = v => (typeof v === 'string' ? v.trim() : '');
module.exports = { fail, str };
