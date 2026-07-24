import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageViewer } from './ImageViewer';

afterEach(() => {
  vi.restoreAllMocks();
});

const ALT = 'Ảnh thử nghiệm';

function renderViewer(onClose = vi.fn()) {
  const utils = render(<ImageViewer src="blob:mock" alt={ALT} fileName="proof.png" onClose={onClose} />);
  return { onClose, ...utils };
}

const img = () => screen.getByAltText(ALT) as HTMLImageElement;
const readout = () => screen.getByRole('status');

describe('ImageViewer — structure & open/close', () => {
  it('renders a modal dialog with the image and a filename label', () => {
    renderViewer();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(img()).toHaveAttribute('src', 'blob:mock');
    expect(screen.getByText('proof.png')).toBeInTheDocument();
  });

  it('moves focus to the close button on open', () => {
    renderViewer();
    expect(screen.getByRole('button', { name: 'Đóng (ESC)' })).toHaveFocus();
  });

  it('locks body scroll while open and restores it on unmount', () => {
    const { unmount } = renderViewer();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on the close button', async () => {
    const { onClose } = renderViewer();
    await userEvent.click(screen.getByRole('button', { name: 'Đóng (ESC)' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', () => {
    const { onClose } = renderViewer();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on the ESC key', () => {
    const { onClose } = renderViewer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT create or revoke object URLs (reuses the caller preview)', () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    renderViewer();
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('ImageViewer — zoom', () => {
  it('starts at 100% and zooms in / out via the toolbar buttons', async () => {
    renderViewer();
    expect(readout()).toHaveTextContent('100%');
    await userEvent.click(screen.getByRole('button', { name: 'Phóng to (phím +)' }));
    expect(readout()).toHaveTextContent('120%');
    await userEvent.click(screen.getByRole('button', { name: 'Thu nhỏ (phím -)' }));
    expect(readout()).toHaveTextContent('100%');
  });

  it('applies zoom presets', async () => {
    renderViewer();
    await userEvent.click(screen.getByRole('button', { name: '150%' }));
    expect(readout()).toHaveTextContent('150%');
    expect(img().style.transform).toContain('scale(1.5)');
    await userEvent.click(screen.getByRole('button', { name: '200%' }));
    expect(readout()).toHaveTextContent('200%');
  });

  it('zooms with the + / - / 0 keyboard shortcuts', () => {
    renderViewer();
    fireEvent.keyDown(document, { key: '+' });
    expect(readout()).toHaveTextContent('120%');
    fireEvent.keyDown(document, { key: '0' });
    expect(readout()).toHaveTextContent('100%');
  });

  it('zooms with the mouse wheel', () => {
    renderViewer();
    fireEvent.wheel(img(), { deltaY: -100 }); // scroll up → zoom in
    expect(readout()).toHaveTextContent('120%');
  });
});

describe('ImageViewer — rotate (view-only)', () => {
  it('rotates right and left in 90° steps', async () => {
    renderViewer();
    expect(img().style.transform).toContain('rotate(0deg)');
    await userEvent.click(screen.getByRole('button', { name: 'Xoay phải (phím R)' }));
    expect(img().style.transform).toContain('rotate(90deg)');
    await userEvent.click(screen.getByRole('button', { name: 'Xoay phải (phím R)' }));
    expect(img().style.transform).toContain('rotate(180deg)');
    await userEvent.click(screen.getByRole('button', { name: 'Xoay trái (phím L)' }));
    expect(img().style.transform).toContain('rotate(90deg)');
  });

  it('rotates via the R / L keyboard shortcuts', () => {
    renderViewer();
    fireEvent.keyDown(document, { key: 'r' });
    expect(img().style.transform).toContain('rotate(90deg)');
    fireEvent.keyDown(document, { key: 'l' });
    expect(img().style.transform).toContain('rotate(0deg)');
  });
});

describe('ImageViewer — reset', () => {
  it('reset returns zoom to 100% and rotation to 0°', async () => {
    renderViewer();
    await userEvent.click(screen.getByRole('button', { name: '200%' }));
    await userEvent.click(screen.getByRole('button', { name: 'Xoay phải (phím R)' }));
    expect(img().style.transform).toContain('scale(2)');
    expect(img().style.transform).toContain('rotate(90deg)');

    await userEvent.click(screen.getByRole('button', { name: 'Đặt lại' }));
    expect(readout()).toHaveTextContent('100%');
    expect(img().style.transform).toContain('scale(1)');
    expect(img().style.transform).toContain('rotate(0deg)');
    expect(img().style.transform).toContain('translate(0px, 0px)');
  });
});
