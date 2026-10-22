export function isIdentityValid(identity: string): boolean {
  identity = identity.trim();
  const compact = identity.replace(/[\s.-]/g, '');
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity);
  const isPhone = /^(?:\+?84|0)\d{9}$/.test(compact);
  return isEmail || isPhone;
}
