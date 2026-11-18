import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '../src/App'

it('renders the placeholder heading', () => {
  render(<App />)
  expect(screen.getByRole('heading').textContent).toBe("Don't Look Away")
})
