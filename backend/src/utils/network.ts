const IPV4_MAPPED_IPV6_PREFIX = '::ffff:';
const IPV4_COMPATIBLE_IPV6_PREFIX = '::';
const LIMIT_IPV6_SUBNET = 56;

const isDottedIpv4 = (value: string): boolean => {
  const segments = value.split('.');
  return segments.length === 4 && segments.every((segment) => {
    if (segment.length === 0 || segment.length > 3) 
      return false;

    const octet = Number(segment);
    return Number.isInteger(octet) && octet >= 0 && octet <= 255 && String(octet) === segment;
  });
};

const isPrivateOrLoopbackIpv4 = (value: string): boolean => {
  if (!isDottedIpv4(value)) 
    return false;

  const [firstOctet, secondOctet] = value.split('.').map((segment) => Number(segment));
  if (firstOctet === 10 || firstOctet === 127) 
    return true;

  if (firstOctet === 172 && typeof secondOctet === 'number' && secondOctet >= 16 && secondOctet <= 31) 
    return true;

  return firstOctet === 192 && secondOctet === 168;
};

export const normalizeIpForRateLimit = (ip: string): string => {
  const normalizedIp = ip.trim().toLowerCase();

  if (normalizedIp.startsWith(IPV4_MAPPED_IPV6_PREFIX)) 
    return normalizedIp.slice(IPV4_MAPPED_IPV6_PREFIX.length);

  if (normalizedIp.startsWith(IPV4_COMPATIBLE_IPV6_PREFIX)) {
    const candidateIpv4 = normalizedIp.slice(IPV4_COMPATIBLE_IPV6_PREFIX.length);
    if (isDottedIpv4(candidateIpv4)) 
      return candidateIpv4;
  }

  return normalizedIp;
};

export const isPrivateOrLoopbackIp = (ip: string): boolean => {
  const normalizedIp = normalizeIpForRateLimit(ip);

  if (isPrivateOrLoopbackIpv4(normalizedIp)) 
    return true;

  return normalizedIp === '::1'
    || normalizedIp === 'localhost'
    || normalizedIp.startsWith('fc')
    || normalizedIp.startsWith('fd')
    || normalizedIp.startsWith('fe80:');
};

export { LIMIT_IPV6_SUBNET };