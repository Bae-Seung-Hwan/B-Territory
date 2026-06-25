import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  firebaseUid: string;

  @Column({ unique: true })
  email: string;

  @Column()
  nickname: string;

  @Column({ length: 2 })
  nationality: string;

  @Column({ length: 2 })
  team: string;

  @CreateDateColumn()
  createdAt: Date;
}
