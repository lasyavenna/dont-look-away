import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from '../src/App'
import { GameProvider } from '../src/app/GameProvider'

it('shows the start screen, then the play screen after Begin', () => {
  render(
    <GameProvider>
      <App />
    </GameProvider>,
  )
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Don't Look Away")
  fireEvent.click(screen.getByRole('button', { name: 'Begin' }))
  expect(screen.queryByRole('button', { name: 'Begin' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Run Tests' })).toBeTruthy()
})
