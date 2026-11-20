import { describe, expect, it } from 'vitest';
import { chooseNote } from './chooseNote';

describe('chooseNote', () => {
  it('names who can choose', () => {
    expect(chooseNote(['Simon', 'Priya'])).toBe('Only an owner or architect can choose an option: Simon, Priya. You can rate and edit options.');
  });
  it('still explains when no name is known', () => {
    expect(chooseNote([])).toBe('Only an owner or architect can choose an option. You can rate and edit options.');
  });
});
