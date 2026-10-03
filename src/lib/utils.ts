// Um cn so para o app inteiro: o de src/components/ui/cn conhece as escalas
// do design system (text-dense, rounded-card, h-ctl-md). O tailwind-merge
// padrao tratava text-dense como cor e apagava o tamanho da fonte quando ele
// vinha junto de text-t2 -- em toda tela que ainda importa daqui.
export { cn } from "@/components/ui/cn";
