package com.vm.identityprovider.entity;

import javax.persistence.*;

@Entity
@Table(name = "tokens")
public class Token {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "user_id")
    private User user;

    @ManyToOne
    @JoinColumn(name = "client_id")
    private Client client;

    @Column(unique = true, nullable = false)
    private String accessToken;

    @Column(unique = true, nullable = false)
    private String refreshToken;

    // getters and setters
}