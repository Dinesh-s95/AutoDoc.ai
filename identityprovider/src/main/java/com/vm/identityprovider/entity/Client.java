package com.vm.identityprovider.entity;

import javax.persistence.*;

@Entity
@Table(name = "clients")
public class Client {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String clientName;

    @Column(nullable = false)
    private String clientSecret;

    

    // getters and setters
}