import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from '@/components/layout/ThemeProvider'
import { SessionProvider } from '@/features/auth/hooks/SessionProvider'
import { queryClient } from '@/lib/queryClient'
import { AppRoutes } from '@/routes/AppRoutes'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SessionProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
