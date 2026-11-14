# Explicações por tarefa

Cada tarefa concluída deixa aqui um arquivo `Txx.md`, escrito pelo executor (ADR 0002, E19). O objetivo é que alguém que não acompanhou a execução entenda o que foi feito e por quê.

## Modelo

```markdown
# Txx — <nome da tarefa>

## O que foi feito
Dois ou três parágrafos em linguagem direta. O que existe agora que não existia antes.

## Por que foi feito assim
As escolhas que a tarefa exigiu e o motivo de cada uma. Cite a decisão do ADR ou a seção do README que sustenta a escolha.

## O que foi descartado
Alternativas consideradas e por que não foram usadas. Se não houve alternativa, diga isso.

## Arquivos principais
Lista dos arquivos criados ou alterados, com uma linha sobre o papel de cada um.

## Como conferir
Os comandos que provam que a tarefa funciona, e o resultado esperado.

## Limitações e pontos de atenção
O que não foi coberto, o que depende do autor e o que pode surpreender quem mexer nisso depois.
```

## Regras

- Escreva para um leitor que conhece o projeto, mas não leu o código.
- Não repita o plano. Explique o que aconteceu na prática, inclusive o que deu errado no caminho.
- Não afirme que algo funciona sem ter rodado o comando de conferência.
