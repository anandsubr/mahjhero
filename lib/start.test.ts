import { describe, expect, it } from 'vitest';
import { askAFriendToHostMessage, inAppPathFromLink, safeReturnPath } from './start';

describe('inAppPathFromLink', () => {
  it('keeps only the path and query of a full app link', () => {
    expect(inAppPathFromLink('https://app.mahjhero.com/clubs/c1/events/e1?x=1')).toBe(
      '/clubs/c1/events/e1?x=1',
    );
  });

  it('never keeps a foreign host: the result is always a route in this app', () => {
    expect(inAppPathFromLink('https://evil.example/clubs/c1/games')).toBe('/clubs/c1/games');
  });

  it('reads a link pasted without its scheme', () => {
    expect(inAppPathFromLink('  dev.mahjhero.com/clubs/c1/games ')).toBe('/clubs/c1/games');
  });

  it('accepts a bare path and the app scheme', () => {
    expect(inAppPathFromLink('/messages/t1')).toBe('/messages/t1');
    expect(inAppPathFromLink('mahjhero://clubs/c1/games')).toBe('/clubs/c1/games');
  });

  it('refuses text that is not a link to an invite screen', () => {
    expect(inAppPathFromLink('')).toBeNull();
    expect(inAppPathFromLink('OAK123')).toBeNull();
    expect(inAppPathFromLink('https://app.mahjhero.com/')).toBeNull();
    expect(inAppPathFromLink('https://app.mahjhero.com/profile')).toBeNull();
    expect(inAppPathFromLink('javascript:alert(1)')).toBeNull();
    expect(inAppPathFromLink('/clubs/')).toBeNull();
  });
});

describe('askAFriendToHostMessage', () => {
  it('ends with the link it was given', () => {
    expect(askAFriendToHostMessage('https://x.test/')).toMatch(/https:\/\/x\.test\/$/);
  });
});

describe('safeReturnPath', () => {
  it("allows this app's own night, group and message screens", () => {
    expect(safeReturnPath('/e/tok_abc')).toBe('/e/tok_abc');
    expect(safeReturnPath('/clubs/c1/games')).toBe('/clubs/c1/games');
  });

  it('refuses anything else', () => {
    expect(safeReturnPath('https://evil.example/e/x')).toBeNull();
    expect(safeReturnPath('//evil.example')).toBeNull();
    expect(safeReturnPath('/e//evil.example')).toBeNull();
    expect(safeReturnPath('/home')).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
  });
});

describe('inAppPathFromLink and Mahj Night links', () => {
  it('opens a pasted event page link in the app', () => {
    expect(inAppPathFromLink('https://app.mahjhero.com/e/tok_abc?r=sec')).toBe('/e/tok_abc?r=sec');
  });
});
