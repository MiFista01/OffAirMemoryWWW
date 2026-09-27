import { animate, animateChild, group, query, state, style, transition, trigger } from "@angular/animations";

export const fadeInOutAnimation = trigger('fadeInOut', [
    state('hidden', style({
        width: '0',
        height: '0',
        opacity: '0',
        padding: '0',
        margin: '0',
        pointerEvents: 'none',
        overflow: 'hidden',
        transform: 'scale(0.5)',
        transformOrigin: 'center center',
        transformStyle: 'preserve-3d'
    })),
    state('visible', style({
        width: '*',
        height: '*',
        opacity: '1',
        padding: '*',
        margin: '*',
        pointerEvents: 'auto',
        transform: 'scale(1)',
        transformOrigin: 'center center',
        transformStyle: 'preserve-3d'
    })),
    transition('hidden <=> visible', [
        group([
            query('@*', animateChild(), { optional: true }),
            animate('600ms cubic-bezier(0.4, 0, 0.2, 1)')
        ]),
    ]),
]);