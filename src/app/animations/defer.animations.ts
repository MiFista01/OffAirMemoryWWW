import { animate, animateChild, group, query, sequence, style, transition, trigger } from "@angular/animations";

export const deferAnimation = trigger('deferAnimation', [
  transition(':enter', [
    style({
      opacity: 0,
      transform: 'translateY(20px) scale(0.95)',
    }),
    group([
      query('@*', animateChild(), { optional: true, delay: 200 }),
      animate('400ms cubic-bezier(0.4, 0, 0.2, 1)',
        style({
          opacity: 1,
          transform: 'translateY(0) scale(1)',
        })
      ),
    ]),
  ]),
  transition(':leave', [
    animate('200ms ease-in', style({ opacity: 0, transform: 'translateY(-20px) scale(0.95)' }))
  ])
])