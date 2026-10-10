import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import PhoneNumberInput from './PhoneNumberInput.svelte';

function parts(container: HTMLElement) {
  return {
    preview: container.querySelector('.country-preview') as HTMLButtonElement,
    calling: container.querySelector('.calling-input') as HTMLInputElement,
    national: container.querySelector('input[inputmode="tel"]') as HTMLInputElement,
  };
}

async function pickCountry(container: HTMLElement, name: RegExp) {
  const { preview } = parts(container);
  await fireEvent.click(preview);
  const option = [...container.querySelectorAll('[role="option"]')].find((item) =>
    name.test(item.textContent ?? ''),
  );
  if (!option) throw new Error(`option ${name} not found`);
  await fireEvent.click(option);
}

describe('PhoneNumberInput', () => {
  it('renders three input-look fields with a compact code preview', () => {
    const { container } = render(PhoneNumberInput, {
      props: { label: 'Destination number', defaultCountry: 'BD' },
    });
    const { preview, calling, national } = parts(container);
    expect(preview.textContent).toContain('BD');
    expect(calling.value).toBe('+880');
    expect(calling.hasAttribute('readonly')).toBe(true);
    expect(national.getAttribute('placeholder')).toBe('01812-345678');
    expect(national.getAttribute('aria-label')).toBe('Destination number');
  });

  it('opens the full country list while previewing only the code', async () => {
    const { container } = render(PhoneNumberInput, {
      props: { label: 'Phone number', defaultCountry: 'BD' },
    });
    const { preview } = parts(container);
    expect(preview.textContent).not.toContain('Bangladesh');
    await fireEvent.click(preview);
    const options = [...container.querySelectorAll('[role="option"]')].map(
      (item) => item.textContent,
    );
    expect(options.some((text) => text?.includes('Bangladesh (BD)'))).toBe(true);
    expect(options.some((text) => text?.includes('United States (US)'))).toBe(true);
  });

  it('couples calling code, mask and placeholder to the picked country', async () => {
    const { container } = render(PhoneNumberInput, {
      props: { label: 'Phone number', defaultCountry: 'BD' },
    });
    await pickCountry(container, /United States/);
    const { preview, calling, national } = parts(container);
    expect(preview.textContent).toContain('US');
    expect(calling.value).toBe('+1');
    expect(national.getAttribute('placeholder')).toBe('(201) 555-0123');
    await fireEvent.input(national, { target: { value: '20155501' } });
    expect(national.value).toBe('(201) 555-01');
  });

  it('masks national entry progressively per the example', async () => {
    const { container } = render(PhoneNumberInput, {
      props: { label: 'Phone number', country: 'BD' },
    });
    const { national } = parts(container);
    await fireEvent.input(national, { target: { value: '01712' } });
    expect(national.value).toBe('01712');
    await fireEvent.input(national, { target: { value: '01712345678' } });
    expect(national.value).toBe('01712-345678');
  });

  it('auto-detects the country from full international entry', async () => {
    const { container } = render(PhoneNumberInput, {
      props: { label: 'Phone number' },
    });
    const { preview, calling, national } = parts(container);
    await fireEvent.input(national, { target: { value: '+8801812345678' } });
    expect(preview.textContent).toContain('BD');
    expect(calling.value).toBe('+880');
    expect(national.value).toBe('18123-45678');
  });
});
