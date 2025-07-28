package com.vm.identityprovider.controller;

import com.vm.identityprovider.entity.Users;
import com.vm.identityprovider.service.JWTService;
import com.vm.identityprovider.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/idp/users")
public class UserController {

    @Autowired
    private UserService userService;

    @Autowired
    private AuthenticationManager authManager;

    @Autowired
    private JWTService jwtService;

    @GetMapping("/home")
    public String greet() {
        return "Welcome to proto-calls";
    }

    @GetMapping("/homeee")
    public String greet2() {
        return "Welcome to proto-calls2";
    }

    @PostMapping("/register")
    public Users registerUser(@RequestBody final Users user) {
        return userService.register(user);
    }

    @PostMapping("/login")
    public ResponseEntity<Object> login(@RequestBody final Users user) {

        final Authentication authentication = authManager.authenticate(
                new UsernamePasswordAuthenticationToken(user.getUsername(), user.getPassword()));

        if (authentication.isAuthenticated()) {
            final String token = jwtService.generateToken(user.getUsername());
            return ResponseEntity.ok().body(Map.of("token", token));
        }
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Invalid username or password"));
    }
}
