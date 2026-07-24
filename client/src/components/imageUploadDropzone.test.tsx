import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageUploadDropzone } from './ImageUploadDropzone';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A controlled harness so the dropzone's `value` reflects onChange. */
function Harness({ disabled, onFile }: { disabled?: boolean; onFile?: (f: File | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <ImageUploadDropzone
      value={file}
      disabled={disabled}
      onChange={(f) => {
        setFile(f);
        onFile?.(f);
      }}
    />
  );
}

function imageFile(name = 'shot.png', type = 'image/png', size = 1000): File {
  const f = new File([new Uint8Array(Math.min(size, 64))], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

/** Fires a document paste event with the given clipboard items. */
function firePaste(items: Array<Partial<DataTransferItem> & { getAsFile?: () => File | null }>) {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { items } });
  act(() => {
    document.dispatchEvent(e);
  });
  return e;
}

function imageItem(type = 'image/png'): Partial<DataTransferItem> & { getAsFile: () => File } {
  return { kind: 'file', type, getAsFile: () => imageFile(`clip.${type.split('/')[1]}`, type, 500) };
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('ImageUploadDropzone — empty state + browse', () => {
  it('shows the paste / drag / click prompt and the format helper', () => {
    render(<Harness />);
    expect(screen.getByText('Dán ảnh bằng Ctrl+V, kéo thả hoặc nhấn để chọn ảnh')).toBeInTheDocument();
    expect(screen.getByText('Chấp nhận PNG, JPEG hoặc WebP. Tối đa 10 MB.')).toBeInTheDocument();
  });

  it('exposes an accessible dropzone with the image accept filter', () => {
    render(<Harness />);
    const zone = screen.getByRole('button', { name: /Vùng tải ảnh/ });
    expect(zone).toHaveAttribute('tabindex', '0');
    expect(fileInput()).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
  });

  it('clicking the zone opens the native file picker', async () => {
    render(<Harness />);
    const spy = vi.spyOn(fileInput(), 'click');
    await userEvent.click(screen.getByRole('button', { name: /Vùng tải ảnh/ }));
    expect(spy).toHaveBeenCalled();
  });

  it('Enter and Space open the file picker', () => {
    render(<Harness />);
    const zone = screen.getByRole('button', { name: /Vùng tải ảnh/ });
    const spy = vi.spyOn(fileInput(), 'click');
    fireEvent.keyDown(zone, { key: 'Enter' });
    fireEvent.keyDown(zone, { key: ' ' });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('ImageUploadDropzone — file selection + validation', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts a valid %s via the picker', async (type) => {
    const onFile = vi.fn();
    render(<Harness onFile={onFile} />);
    await userEvent.upload(fileInput(), imageFile(`a.${type.split('/')[1]}`, type, 800));
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ type }));
  });

  it('rejects an unsupported file type', () => {
    const onFile = vi.fn();
    render(<Harness onFile={onFile} />);
    // fireEvent (not userEvent.upload) so the input's accept filter is bypassed —
    // this simulates a file that reached the handler and must be rejected by our
    // own validation.
    fireEvent.change(fileInput(), { target: { files: [imageFile('a.gif', 'image/gif', 800)] } });
    expect(screen.getByText('Định dạng ảnh không được hỗ trợ.')).toBeInTheDocument();
    expect(onFile).not.toHaveBeenCalled();
  });

  it('rejects an oversized image', async () => {
    const onFile = vi.fn();
    render(<Harness onFile={onFile} />);
    await userEvent.upload(fileInput(), imageFile('big.png', 'image/png', 11 * 1024 * 1024));
    expect(screen.getByText('Ảnh vượt quá dung lượng tối đa 10 MB.')).toBeInTheDocument();
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe('ImageUploadDropzone — clipboard paste', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts a pasted %s and shows the success notice', (type) => {
    render(<Harness />);
    firePaste([imageItem(type)]);
    expect(screen.getByRole('status')).toHaveTextContent('Đã dán ảnh từ clipboard.');
    // Preview shows a generated pasted filename.
    expect(screen.getByText(/^pasted-proof-\d+\./)).toBeInTheDocument();
  });

  it('ignores plain-text clipboard content (no error, no change)', () => {
    render(<Harness />);
    firePaste([{ kind: 'string', type: 'text/plain', getAsFile: () => null }]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Still the empty state.
    expect(screen.getByText('Dán ảnh bằng Ctrl+V, kéo thả hoặc nhấn để chọn ảnh')).toBeInTheDocument();
  });

  it('rejects an unsupported pasted image with a clear message', () => {
    render(<Harness />);
    firePaste([{ kind: 'file', type: 'image/gif', getAsFile: () => imageFile('x.gif', 'image/gif') }]);
    expect(screen.getByText('Clipboard không có ảnh PNG, JPEG hoặc WebP hợp lệ.')).toBeInTheDocument();
  });
});

describe('ImageUploadDropzone — drag and drop', () => {
  it('highlights the zone on drag over and shows the drop prompt', () => {
    render(<Harness />);
    const zone = screen.getByRole('button', { name: /Vùng tải ảnh/ });
    fireEvent.dragOver(zone);
    expect(screen.getByText('Thả ảnh vào đây')).toBeInTheDocument();
    fireEvent.dragLeave(zone);
    expect(screen.queryByText('Thả ảnh vào đây')).not.toBeInTheDocument();
  });

  it('accepts a dropped valid image', () => {
    const onFile = vi.fn();
    render(<Harness onFile={onFile} />);
    const zone = screen.getByRole('button', { name: /Vùng tải ảnh/ });
    fireEvent.drop(zone, { dataTransfer: { files: [imageFile('drop.png', 'image/png', 900)] } });
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }));
  });

  it('uses the first file and warns when multiple files are dropped', () => {
    const onFile = vi.fn();
    render(<Harness onFile={onFile} />);
    const zone = screen.getByRole('button', { name: /Vùng tải ảnh/ });
    fireEvent.drop(zone, {
      dataTransfer: { files: [imageFile('one.png', 'image/png', 500), imageFile('two.png', 'image/png', 500)] },
    });
    expect(screen.getByText('Chỉ được gửi một ảnh cho mỗi lần xác nhận.')).toBeInTheDocument();
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'one.png' }));
  });
});

describe('ImageUploadDropzone — preview / replace / remove', () => {
  it('shows the preview with filename, type, size and dimensions', () => {
    render(<Harness />);
    firePaste([imageItem('image/png')]);
    expect(screen.getByText(/^pasted-proof-\d+\.png$/)).toBeInTheDocument();
    const meta = screen.getByText(/PNG · /);
    expect(meta.textContent).toMatch(/PNG · /);

    const img = screen.getByAltText('Xem trước ảnh sẽ gửi') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 1280, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 720, configurable: true });
    fireEvent.load(img);
    expect(screen.getByText(/1280 × 720/)).toBeInTheDocument();
  });

  it('replaces the image via the file picker and revokes the old preview URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    render(<Harness />);
    await userEvent.upload(fileInput(), imageFile('first.png', 'image/png', 500));
    expect(screen.getByText('first.png')).toBeInTheDocument();

    await userEvent.upload(fileInput(), imageFile('second.png', 'image/png', 500));
    expect(screen.getByText('second.png')).toBeInTheDocument();
    expect(revoke).toHaveBeenCalled(); // old preview URL revoked on replace
  });

  it('removes the image, returns to the empty state and revokes the URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    render(<Harness />);
    await userEvent.upload(fileInput(), imageFile('shot.png', 'image/png', 500));
    expect(screen.getByText('shot.png')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Xóa ảnh' }));
    expect(screen.getByText('Dán ảnh bằng Ctrl+V, kéo thả hoặc nhấn để chọn ảnh')).toBeInTheDocument();
    expect(revoke).toHaveBeenCalled();
  });

  it('revokes the object URL on unmount', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { unmount } = render(<Harness />);
    await userEvent.upload(fileInput(), imageFile('shot.png', 'image/png', 500));
    unmount();
    expect(revoke).toHaveBeenCalled();
  });
});

describe('ImageUploadDropzone — auto replace (newest image wins)', () => {
  it('a second paste replaces the first and revokes the old preview URL', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    render(<Harness />);
    firePaste([imageItem('image/png')]);
    expect(screen.getByText(/^pasted-proof-\d+\.png$/)).toBeInTheDocument();

    firePaste([imageItem('image/jpeg')]);
    // The newest image is shown; the previous one is gone — no duplicate preview.
    expect(screen.getByText(/^pasted-proof-\d+\.jpg$/)).toBeInTheDocument();
    expect(screen.queryByText(/^pasted-proof-\d+\.png$/)).not.toBeInTheDocument();
    expect(screen.getAllByAltText('Xem trước ảnh sẽ gửi')).toHaveLength(1);
    expect(revoke).toHaveBeenCalled();
  });

  it('a second drop replaces the first and revokes the old preview URL', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    render(<Harness />);
    // First drop on the empty-state zone (bubbles to the outer onDrop handler).
    fireEvent.drop(screen.getByRole('button', { name: /Vùng tải ảnh/ }), {
      dataTransfer: { files: [imageFile('one.png', 'image/png', 500)] },
    });
    expect(screen.getByText('one.png')).toBeInTheDocument();

    // Second drop over the preview image (also bubbles to the same outer handler).
    fireEvent.drop(screen.getByAltText('Xem trước ảnh sẽ gửi'), {
      dataTransfer: { files: [imageFile('two.png', 'image/png', 500)] },
    });
    expect(screen.getByText('two.png')).toBeInTheDocument();
    expect(screen.queryByText('one.png')).not.toBeInTheDocument();
    expect(screen.getAllByAltText('Xem trước ảnh sẽ gửi')).toHaveLength(1);
    expect(revoke).toHaveBeenCalled();
  });

  it('a second browse replaces the first and revokes the old preview URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    render(<Harness />);
    await userEvent.upload(fileInput(), imageFile('first.png', 'image/png', 500));
    expect(screen.getByText('first.png')).toBeInTheDocument();

    await userEvent.upload(fileInput(), imageFile('second.png', 'image/png', 500));
    expect(screen.getByText('second.png')).toBeInTheDocument();
    expect(screen.queryByText('first.png')).not.toBeInTheDocument();
    expect(revoke).toHaveBeenCalled();
  });
});

describe('ImageUploadDropzone — zoom viewer', () => {
  it('clicking the preview opens the image viewer, and it can be closed', async () => {
    render(<Harness />);
    await userEvent.upload(fileInput(), imageFile('shot.png', 'image/png', 500));

    await userEvent.click(screen.getByRole('button', { name: 'Phóng to ảnh xem trước' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Đóng (ESC)' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opening the viewer does not create a new object URL (reuses the preview)', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    render(<Harness />);
    await userEvent.upload(fileInput(), imageFile('shot.png', 'image/png', 500));
    expect(create).toHaveBeenCalledTimes(1); // one preview URL

    await userEvent.click(screen.getByRole('button', { name: 'Phóng to ảnh xem trước' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1); // viewer reused it — no second URL
  });
});

describe('ImageUploadDropzone — disabled', () => {
  it('does not accept a pasted image while disabled and is not focusable', () => {
    render(<Harness disabled />);
    const zone = screen.getByRole('button', { name: /Vùng tải ảnh/ });
    expect(zone).toHaveAttribute('tabindex', '-1');
    firePaste([imageItem('image/png')]);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
