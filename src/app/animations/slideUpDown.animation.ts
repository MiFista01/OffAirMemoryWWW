import { animate, style, transition, trigger, state, group, animateChild, query } from '@angular/animations';

export const slideUpDownAnimation = trigger('slideUpDown', [
  state('hidden', style({
    height: '0 ',
    opacity: '0',
    padding: '0',
    margin: '0',
    transform: 'translateY(-10px)',
    overflow: 'hidden',
    pointerEvents: 'none'
  })),
  state('visible', style({
    height: '*',
    opacity: '1',
    padding: '*',
    margin: '*',
    transform: 'translateY(0)',
    pointerEvents: 'auto'
  })),
  transition('hidden <=> visible', [
    group([
      query('@*', animateChild(), { optional: true }),
      animate('600ms cubic-bezier(0.4, 0, 0.2, 1)')
    ]),
  ])
]);