package com.vm.usermanagement.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "mobility_users")
@Getter
@Setter
public class MobilityUser {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String username; // from IdentityProvider
    private String mobilityUserId; // internal unique ID
    private String vin; // associated vehicle VIN
    private String role; // e.g., PRIMARY_USER, SECONDARY_USER
}
