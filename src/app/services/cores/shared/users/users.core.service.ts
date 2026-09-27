import { HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '@env';
import { User } from '@interface';
import { RequestsService } from '@services';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class UsersCoreService {
  constructor(
    private readonly req: RequestsService
  ) { }

  getUserById(id: number, includes?: string[]): Observable<User | undefined> {
    const activeFields = includes?.map(field => 'user.' + field);
    const query = new HttpParams()
    .set('relations', activeFields?.join(',') || '');
    return this.req.Get<User>(`${environment.apiUrl}/user/${id}`, query);
  }
}
