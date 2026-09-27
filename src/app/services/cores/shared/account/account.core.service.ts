import { Auth, PersonalInfo, Profile, Settings, User } from '@interface';
import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, catchError, filter, finalize, map, Observable, of, shareReplay, Subscription, take, timer } from 'rxjs';
import { merge } from "ts-deepmerge";
import { RequestsService } from '@services';
import { environment } from '@env';
import { UserPropertiesService } from '@abstracts';

type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>;
} : T;


/**
 * Account core: lazy-loaded user state, cross-tab sync, logout.
 */
@Injectable({
  providedIn: 'root'
})
export class AccountCoreService extends UserPropertiesService {
  private channel?: BroadcastChannel;
  isUpdatingFromChannel = false;

  public readonly logout_$ = signal<boolean>(false);
  private readonly req_ = new Subscription();
  private readonly $data: BehaviorSubject<User | undefined>
  public readonly user$: Observable<User | undefined>;

  get userValue(): User | undefined {
    return this.$data.value ?? undefined;
  }

  public readonly updateUser: (updatedData: DeepPartial<User>) => void;
  get userId$(): Observable<number> {
    return this.$data.pipe(
      filter((user): user is NonNullable<User> => user !== undefined),
      map(user => user.id),
      shareReplay(1)
    );
  }

  constructor(
    private readonly req: RequestsService,
  ) {
    const $data = new BehaviorSubject<User | undefined>(undefined);
    const user$ = $data.asObservable();

    const updateUser = (updatedData: DeepPartial<User>) => {
      const currentUser = structuredClone(this.$data.getValue());
      if (!currentUser) {
        console.warn('Cannot update user: no current user found');
        return;
      }
      const newUser = merge.withOptions(
        { mergeArrays: false },
        {},
        currentUser,
        updatedData,
      ) as User;
      this.$data.next(newUser);
    }

    super($data, user$, updateUser, req);
    this.$data = $data;
    this.user$ = user$;
    this.updateUser = updateUser;
    if ('BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('user-updates');
      this.setupChannelListener();
    }
  }

  private setupChannelListener() {
    if (!this.channel) return;

    this.channel.onmessage = (event) => {
      if (event.data.type === 'user-changed') {
        this.isUpdatingFromChannel = true;
        this.updateChannel(event.data.user);
        this.isUpdatingFromChannel = false;
      }
    };
  }

  async saveActiveAccountById(id: number) {
    this.req_.add(
      this.req.Get<User>(`${environment.apiUrl}/user/${id}`)
        .pipe(
          take(1),
          catchError((err) => {
            this.$data.next(undefined);
            console.log('saveActiveAccountById error', err);
            return of(undefined);
          })
        )
        .subscribe(user => {
          this.$data.next(user || undefined);
        })
    )
  }

  logout() {
    this.req_.add(
      this.req.Get<void>(`${environment.apiUrl}/auth/logout`)
        .pipe(
          take(1),
          catchError(() => {
            this.$data.next(undefined);
            this.logout_$.set(true);
            return of(null);
          }),
          finalize(() => {
            timer(500).subscribe(() => {
              this.logout_$.set(false);

            })
          })
        )
        .subscribe((res: any) => {
          if (res && res.status === 202) {
            this.$data.next(undefined);
            this.logout_$.set(true);
          }
        })
    )
  }

  private updateChannel(newUser: User) {
    const clonedUser = structuredClone(newUser);
    this.$data.next(clonedUser);

    if (!this.channel || this.isUpdatingFromChannel) return;

    this.channel.postMessage({
      type: 'user-changed',
      user: clonedUser
    });
  }

  get auth$(): Observable<Auth> {
    return this.load$<Auth>('auth', 'user-auth');
  };

  get profile$(): Observable<Profile> {
    return this.load$<Profile>('profile');
  };

  get settings$(): Observable<Settings> {
    return this.load$<Settings>('settings', 'user-settings');
  };

  get personalInfo$(): Observable<PersonalInfo> {
    return this.load$<PersonalInfo>('personalInfo');
  };
}
