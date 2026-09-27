import { animate, group, animateChild, query, state, style, transition, trigger } from "@angular/animations";

export const slideLeftRightAnimation = trigger('slideLeftRight', [
  state('hidden', style({
    width: '0',
    opacity: '0',
    padding: '0',
    margin: '0',
    transform: 'translateX(10px)scaleX(0)',
    transformOrigin: '100% 50%',
    pointerEvents: 'none'
  })),
  state('visible', style({
    width: '*',
    padding: '*',
    margin: '*',
    opacity: '1',
    transformOrigin: '100% 50%',
    transform: 'translateX(0) scaleX(1)',
    pointerEvents: 'auto'
  })),
  transition('hidden <=> visible', [
    group([
      query('@*', animateChild(), { optional: true }),
      animate('600ms cubic-bezier(0.4, 0, 0.2, 1)')
    ]),
  ]),
  
]);