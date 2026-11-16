import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Sem `globals`, o Testing Library não limpa a tela entre testes sozinho.
afterEach(() => cleanup())
