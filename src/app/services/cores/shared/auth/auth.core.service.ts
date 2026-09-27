import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '@env';
import { UserData } from '@interface';
import { RequestsService } from '@services';
import { BehaviorSubject, catchError, map, Observable, of, tap } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthCoreService {
  private $userData = new BehaviorSubject<UserData | null>(null);
  public userData$ = this.$userData.asObservable();

  get userData(): UserData | null {
    return this.$userData.getValue();
  }

  constructor(
    private readonly req: RequestsService,
    private readonly router: Router
  ) { }

  checkUser(): Observable<UserData> {
    return this.req.Get<{ data: UserData }>(`${environment.apiUrl}/auth/check-user`)
      .pipe(
        tap(response => this.$userData.next(response.data)),
        map((res) => {
          return res.data;
        }),
        catchError((err)=>{
          this.router.navigate(['/guest'])
          return of(err)
        })
      );
  }
}
