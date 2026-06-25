import { createHmac } from 'node:crypto';

function truncate(ip: string): string | null {
  // IPv6
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length < 3) return null;
    return parts.slice(0, 3).join(':') + '::/48';
  }
  // IPv4
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  if (parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

export function hashIp(ip: string | null | undefined, secret: string): string | null {
  if (!secret) throw new Error('IP_HASH_SECRET é obrigatório');
  if (ip == null || ip === '') return null;
  const subnet = truncate(ip);
  if (!subnet) return null;
  return createHmac('sha256', secret).update(subnet).digest('hex');
}
