import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ScanField } from './ScanField';

describe('ScanField', () => {
  it('is ready for the scanner when it opens', () => {
    render(<ScanField onScan={vi.fn()} />);
    expect(screen.getByLabelText('Scan or type a case barcode')).toHaveFocus();
  });

  it('keeps codes scanned while one is being checked, and sends them next, in order', async () => {
    const user = userEvent.setup();
    const onScan = vi.fn();
    const { rerender } = render(<ScanField onScan={onScan} />);
    const field = screen.getByLabelText('Scan or type a case barcode');

    await user.type(field, '10012345678902{Enter}');
    expect(onScan).toHaveBeenLastCalledWith('10012345678902');

    // The first code is being checked: the wedge scanner keeps typing, and nothing is dropped.
    rerender(<ScanField onScan={onScan} disabled />);
    await user.type(field, '20012345678909{Enter}');
    await user.type(field, '30012345678906{Enter}');
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(field).toHaveValue('');

    // Each result releases the next code, and the field is focused for the one after.
    rerender(<ScanField onScan={onScan} />);
    expect(onScan).toHaveBeenLastCalledWith('20012345678909');
    expect(field).toHaveFocus();
    rerender(<ScanField onScan={onScan} disabled />);
    rerender(<ScanField onScan={onScan} />);
    expect(onScan).toHaveBeenLastCalledWith('30012345678906');
    expect(onScan).toHaveBeenCalledTimes(3);
  });
});
