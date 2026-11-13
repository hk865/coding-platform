/**
 * NB-01 (netb-start-rulings §2.2 item 1; A5 pure table): which resolved addresses a command may never reach — the
 * loopback, private, link-local, shared and reserved ranges, IPv6 addresses that carry an IPv4 one (mapped,
 * compatible, NAT64, in any spelling), and every address of this machine's own interfaces. The refusal guards safety
 * (121-111): the platform page on this machine carries the instance token, internal services and cloud metadata
 * (169.254.169.254) live on these ranges. Expected values are the ruling's literals.
 *
 * Red today: the import of `src/app/command-sandbox.ts` (the module does not exist), every cell. Green after B1.
 * Named mutations (each turns its cells red): drop 10/8; drop 169.254/16; drop 100.64/10; drop fc00::/7; judge a
 * mapped address without unwrapping it (`::ffff:7f00:1`); do not unwrap NAT64 (`64:ff9b::a00:1`); ignore the local
 * addresses (the first `93.184.216.40` cell); write 172.16/12 as /11 (the `172.32.0.1` cell).
 */
import { expect, it } from 'vitest';
import { commandNetworkBlocked } from '../../src/app/command-sandbox.js';

const OWN = ['93.184.216.40'];

it.each<[string, readonly string[], boolean]>([
  ['127.255.255.254', [], true], ['0.0.0.0', [], true], ['10.1.2.3', [], true], ['172.31.255.255', [], true],
  ['192.168.1.1', [], true], ['169.254.169.254', [], true], ['100.64.0.1', [], true], ['224.0.0.1', [], true],
  ['255.255.255.255', [], true], ['::1', [], true], ['::', [], true], ['fe80::1', [], true], ['fd12::1', [], true],
  ['ff02::1', [], true], ['::ffff:127.0.0.1', [], true], ['::ffff:7f00:1', [], true], ['64:ff9b::a00:1', [], true],
  ['93.184.216.40', OWN, true],
  ['172.32.0.1', [], false], ['100.128.0.1', [], false], ['8.8.8.8', [], false], ['::ffff:8.8.8.8', [], false],
  ['2606:4700::1111', [], false], ['93.184.216.40', [], false],
])('NB-01 %s with local addresses %j is blocked: %s', (address, local, blocked) => {
  expect(commandNetworkBlocked(address, local)).toBe(blocked);
});
