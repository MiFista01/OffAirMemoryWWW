import { BehaviorSubject, catchError, Observable, take } from "rxjs";
import { User } from "@interface";
import { distinctUntilChanged, switchMap, tap } from "rxjs";
import { of } from "rxjs";
import { strictDeepEqual } from "fast-equals";
import { RequestsService } from "@services";
import { environment } from "@env";

/**
 * Abstract base service for managing user properties with lazy loading and caching.
 * 
 * Provides a foundation for user data management with the following features:
 * - Lazy loading of user properties (data loaded only when first accessed)
 * - Automatic caching of loaded data to prevent redundant API calls
 * - Reactive data flow using RxJS Observables
 * - Deep equality checking to prevent unnecessary updates
 * - Error handling for failed data loads
 * 
 * @example
 * get profile$(): Observable<Profile> {
 *  return this.load$<Profile>('profile');
 * }
 */
export abstract class UserPropertiesService {
    protected userProperties$ = new Map<keyof User, {
        obs: Observable<unknown>;
        url: string;
        scope: 'userId' | 'my';
    }>();

    constructor(
        private readonly subject: BehaviorSubject<User | undefined>,
        private readonly obs$: Observable<User | undefined>,
        private readonly update: (updatedData: Partial<User>) => void,
        private readonly reqParent: RequestsService
    ) { }

    private createLazyObservable<T>(
        loadData: () => Observable<T>,
        updateKey: keyof User,
    ): Observable<T> {
        return this.obs$.pipe(
            switchMap((user) => {
                if (!user) {
                    return of(undefined as T);
                }
                if (updateKey in user && user[updateKey] !== undefined) {
                    return of(user[updateKey] as T);
                }
                return loadData().pipe(
                    tap((newData) => {
                        const currentUser = this.subject.getValue();
                        if (
                            currentUser
                            && updateKey in currentUser
                            && currentUser[updateKey] !== undefined
                        ) {
                            return;
                        }
                        this.update({ [updateKey]: newData });
                    }),
                    catchError(() => of(undefined as T)),
                );
            }),
            distinctUntilChanged(strictDeepEqual),
        );
    }

    load$<T>(updateKey: keyof User, urlPart?: string): Observable<T> {
        if (this.userProperties$.has(updateKey)) {
            return this.userProperties$.get(updateKey)?.obs as Observable<T>;
        }
        const endpoint = urlPart || String(updateKey);
        const reqSubject = this.createLazyObservable<T>(
            () => this.reqParent.Get<T>(
                `${environment.apiUrl}/${endpoint}/${this.subject.getValue()?.id}`,
            ),
            updateKey,
        );
        this.userProperties$.set(updateKey, {
            obs: reqSubject,
            url: endpoint,
            scope: 'userId',
        });
        return reqSubject;
    }

    loadMy$<T>(updateKey: keyof User, urlPart: string): Observable<T> {
        if (this.userProperties$.has(updateKey)) {
            return this.userProperties$.get(updateKey)?.obs as Observable<T>;
        }
        const reqSubject = this.createLazyObservable<T>(
            () => this.reqParent.Get<T>(`${environment.apiUrl}/${urlPart}`),
            updateKey,
        );
        this.userProperties$.set(updateKey, {
            obs: reqSubject,
            url: urlPart,
            scope: 'my',
        });
        return reqSubject;
    }

    backendSync<T>(updateKey: keyof User): Observable<T> {
        const properties = this.userProperties$.get(updateKey);
        if (!properties) {
            return of(undefined as T);
        }
        const currentUser = this.subject.getValue();
        if (!currentUser) {
            return of(undefined as T);
        }
        const url = properties.scope === 'my'
            ? `${environment.apiUrl}/${properties.url}`
            : `${environment.apiUrl}/${properties.url}/${currentUser.id}`;
        return this.reqParent.Get<T>(url)
            .pipe(
                distinctUntilChanged(strictDeepEqual),
                take(1),
                tap((data: T) => {
                    if (data) {
                        this.update({ [updateKey]: data });
                    } else {
                        console.error('No data returned from backend');
                    }
                }),
                catchError((error) => {
                    console.error(error);
                    return of(undefined as T);
                }),
            );
    }
}