import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SelectDropdown from './SelectDropdown.svelte';

const OPTIONS = [
  { value: '', label: 'Use profile default' },
  { value: 'BD', label: 'Bangladesh (BD)', hint: '+880', preview: 'BD' },
  { value: 'US', label: 'United States (US)', hint: '+1', preview: 'US' },
];

describe('SelectDropdown', () => {
  it('previews the compact code while listing full labels', async () => {
    const { container } = render(SelectDropdown, {
      props: { value: 'BD', options: OPTIONS, label: 'Default country' },
    });
    const preview = container.querySelector('.select-preview') as HTMLButtonElement;
    expect(preview.textContent).toContain('BD');
    expect(preview.textContent).not.toContain('Bangladesh');
    await fireEvent.click(preview);
    const labels = [...container.querySelectorAll('[role="option"]')].map(
      (item) => item.textContent,
    );
    expect(labels.some((text) => text?.includes('Bangladesh (BD)'))).toBe(true);
    expect(labels.some((text) => text?.includes('+880'))).toBe(true);
  });

  it('picks a value and closes', async () => {
    const { container } = render(SelectDropdown, {
      props: { value: '', options: OPTIONS, label: 'Phonebook store' },
    });
    await fireEvent.click(container.querySelector('.select-preview') as HTMLButtonElement);
    const option = [...container.querySelectorAll('[role="option"]')].find((item) =>
      (item.textContent ?? '').includes('United States'),
    );
    if (!option) throw new Error('option missing');
    await fireEvent.click(option);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect((container.querySelector('.select-preview') as HTMLButtonElement).textContent).toContain(
      'US',
    );
  });

  it('filters a long list and skips search for short ones', async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      value: `v${index}`,
      label: `Label ${index}`,
    }));
    const { container } = render(SelectDropdown, {
      props: { value: '', options: many, label: 'Many' },
    });
    await fireEvent.click(container.querySelector('.select-preview') as HTMLButtonElement);
    const search = container.querySelector(
      'input[aria-label="Search…"]',
    ) as HTMLInputElement | null;
    expect(search).toBeTruthy();
    await fireEvent.input(search as HTMLInputElement, { target: { value: 'Label 1' } });
    expect(container.querySelectorAll('[role="option"]').length).toBe(1);

    const { container: short } = render(SelectDropdown, {
      props: { value: '', options: OPTIONS, label: 'Short' },
    });
    await fireEvent.click(short.querySelector('.select-preview') as HTMLButtonElement);
    expect(short.querySelector('input[aria-label="Search…"]')).toBeNull();
  });

  it('closes on Escape without picking', async () => {
    const { container } = render(SelectDropdown, {
      props: { value: 'BD', options: OPTIONS, label: 'Default country' },
    });
    const preview = container.querySelector('.select-preview') as HTMLButtonElement;
    await fireEvent.click(preview);
    expect(container.querySelector('[role="listbox"]')).toBeTruthy();
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(preview.textContent).toContain('BD');
  });
});
