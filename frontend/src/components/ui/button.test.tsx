import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Button } from './button'

test('o botão mantém text-rotulo ao lado da cor da variante', () => {
  for (const variant of ['default', 'outline', 'ghost'] as const) {
    const { unmount } = render(<Button variant={variant}>Ok</Button>)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('text-rotulo')
    expect(cls).toMatch(/text-(papel|tinta)/)
    unmount()
  }
})
