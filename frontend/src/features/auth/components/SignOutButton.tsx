import { useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { signOut } from '../api'

export function SignOutButton({ onError }: { onError: (message: string) => void }) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  async function handle() {
    setPending(true)
    try {
      await signOut()
      queryClient.clear()
    } catch {
      onError('Não foi possível sair. Tente de novo.')
    } finally {
      setPending(false)
    }
  }
  return (
    <Button variant="outline" onClick={() => void handle()} disabled={pending}>
      <LogOut aria-hidden="true" className="size-5" />
      Sair
    </Button>
  )
}
